import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

/** День без скидок: total = gross = net. */
const noDiscount = (date: string, total: number) => ({ date, total, gross: total, discount: 0, net: total });

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      noDiscount("2026-02-09", 0),
      noDiscount("2026-02-10", 1000),
      noDiscount("2026-02-11", 349),
    ]);
  });

  it("учитывает переход на летнее время: смещение берётся на момент заказа", async () => {
    // Europe/Berlin: до 29.03.2026 01:00Z — UTC+1, после — UTC+2.
    // Заказы по обе стороны перехода, поэтому тест не зависит от текущей даты.
    ctx.api.customers.set("c_3", "Europe/Berlin");
    const order = (amount: number, createdAt: string) => apiOrder({ customerId: "c_3", amount, createdAt });
    await postWebhook(ctx.app, order(100, "2026-03-28T22:30:00Z")); // 28.03 23:30 (UTC+1)
    await postWebhook(ctx.app, order(200, "2026-03-28T23:30:00Z")); // 29.03 00:30 (UTC+1)
    await postWebhook(ctx.app, order(400, "2026-03-29T21:30:00Z")); // 29.03 23:30 (UTC+2)
    await postWebhook(ctx.app, order(800, "2026-03-29T22:30:00Z")); // 30.03 00:30 (UTC+2)

    const res = await dailyTotals(ctx.app, "c_3", "2026-03-28", "2026-03-30");
    expect(res.json()).toEqual([
      noDiscount("2026-03-28", 100),
      noDiscount("2026-03-29", 600),
      noDiscount("2026-03-30", 800),
    ]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([noDiscount("2026-02-10", 500)]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([noDiscount("2026-02-10", 800)]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /customers/:id/daily-totals — скидки", () => {
  it("gross — до скидки, net — оплачено, discount — разница; total = gross", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 2000, discountPercent: 20, amountPaid: 1600 }));
    await postWebhook(ctx.app, apiOrder({ amount: 500, discountPercent: 0, amountPaid: 500 }));
    // Пример из задания: 2500 → 2087.5
    await postWebhook(ctx.app, apiOrder({ amount: 2500, discountPercent: 16.5, amountPaid: 2087.5, createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-11");
    expect(res.json()).toEqual([
      { date: "2026-02-10", total: 2500, gross: 2500, discount: 400, net: 2100 },
      { date: "2026-02-11", total: 2500, gross: 2500, discount: 412.5, net: 2087.5 },
    ]);
  });

  it("считает до копейки, без погрешностей float", async () => {
    // В float: 4723.9 + 1217.61 + 2379.2 = 8320.709999999999, а 0.1 + 0.2 = 0.30000000000000004
    await postWebhook(ctx.app, apiOrder({ amount: 5249, discountPercent: 10, amountPaid: 4723.9 }));
    await postWebhook(ctx.app, apiOrder({ amount: 1309, discountPercent: 7, amountPaid: 1217.61 }));
    await postWebhook(ctx.app, apiOrder({ amount: 2974, discountPercent: 20, amountPaid: 2379.2 }));
    await postWebhook(ctx.app, apiOrder({ amount: "0.30", amountPaid: "0.10" }));
    await postWebhook(ctx.app, apiOrder({ amount: "0.30", amountPaid: "0.20" }));

    const [day] = (await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10")).json();
    expect(day).toEqual({ date: "2026-02-10", total: 9532.6, gross: 9532.6, discount: 1211.59, net: 8321.01 });
  });

  it("заказ без amountPaid и discountPercent (до появления скидок) — без скидки", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1000 }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([noDiscount("2026-02-10", 1000)]);
  });

  it("без amountPaid, но со скидкой — оплата считается из discountPercent", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 999, discountPercent: "15" }));
    const [day] = (await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10")).json();
    expect(day).toMatchObject({ gross: 999, discount: 149.85, net: 849.15 });
  });

  it("amountPaid — источник правды, даже если не сходится с discountPercent", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 850 }));
    const [day] = (await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10")).json();
    expect(day).toMatchObject({ gross: 1000, discount: 150, net: 850 });
  });

  it("берёт amountPaid из последней версии заказа", async () => {
    const o = apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900, updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, discountPercent: 30, amountPaid: 700, updatedAt: "2026-02-10T14:00:00Z" });
    await postWebhook(ctx.app, o);
    const [day] = (await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10")).json();
    expect(day).toMatchObject({ gross: 1000, net: 700 });
  });

  it("строка, сохранённая до миграции (paid_kop = NULL), считается без скидки", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900 }));
    await ctx.db.query(`UPDATE orders SET paid_kop = NULL`);
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([noDiscount("2026-02-10", 1000)]);
  });
});
