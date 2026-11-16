import { z } from "zod";
import { ValidationError } from "../errors.js";
import type { Order, OrdersRepository } from "../repositories/orders.js";
import { parseDecimal, parseRub, toKop } from "../utils/money.js";
import { parseUtc } from "../utils/time.js";

/** Заказ в формате внешнего API (поля, которые нам нужны; остальные игнорируем). */
const ExternalOrder = z.object({
  id: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  // Появились в API недавно: в старых заказах их нет
  discountPercent: z.union([z.number(), z.string()]).nullish(),
  amountPaid: z.union([z.number(), z.string()]).nullish(),
  status: z.enum(["pending", "paid", "refunded"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApplyResult = "created" | "updated" | "stale";

/**
 * Сколько оплачено, в копейках. Источник правды — amountPaid.
 * Без amountPaid (старые заказы) — amount со скидкой discountPercent; без скидки — amount целиком.
 */
function paidKop(amountKop: number, amountPaid: unknown, discountPercent: unknown): number {
  let paid: number;
  if (amountPaid !== undefined && amountPaid !== null) {
    paid = toKop(parseRub(amountPaid));
  } else if (discountPercent !== undefined && discountPercent !== null) {
    const pct = parseDecimal(discountPercent);
    if (pct === null || pct < 0 || pct > 100) {
      throw new Error(`invalid discountPercent: ${JSON.stringify(discountPercent)}`);
    }
    // Доли копейки отбрасываем, как в toKop
    paid = Math.floor(Number(((amountKop * (100 - pct)) / 100).toFixed(6)));
  } else {
    paid = amountKop;
  }
  if (paid > amountKop) throw new Error(`amountPaid ${paid / 100} exceeds amount ${amountKop / 100}`);
  return paid;
}

export class OrdersService {
  constructor(private readonly orders: OrdersRepository) {}

  normalize(raw: unknown): Order {
    const parsed = ExternalOrder.safeParse(raw);
    if (!parsed.success) throw new ValidationError(`invalid order: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
    const o = parsed.data;
    try {
      const amountKop = toKop(parseRub(o.amount));
      return {
        id: o.id,
        customerId: o.customerId,
        amountKop,
        paidKop: paidKop(amountKop, o.amountPaid, o.discountPercent),
        status: o.status,
        createdAt: parseUtc(o.createdAt),
        updatedAt: parseUtc(o.updatedAt),
      };
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
  }

  /**
   * Применяет версию заказа (из синка или вебхука).
   * Вебхуки приходят с повторами и не по порядку, поэтому версию сохраняем,
   * только если она новее уже сохранённой (по updatedAt). Сравнение — атомарно в БД:
   * вебхуки приходят параллельно, и разные версии одного заказа могут обрабатываться одновременно.
   */
  async apply(raw: unknown): Promise<ApplyResult> {
    return this.orders.saveIfNewer(this.normalize(raw));
  }
}
