import type { Db } from "../db.js";

export interface Order {
  id: string;
  customerId: string;
  /** Сумма до скидки. */
  amountKop: number;
  /** Фактически оплачено (со скидкой). null — заказ сохранён до появления скидок в API. */
  paidKop: number | null;
  status: "pending" | "paid" | "refunded";
  createdAt: Date;
  updatedAt: Date;
}

interface Row {
  id: string;
  customer_id: string;
  amount_kop: string;
  paid_kop: string | null;
  status: Order["status"];
  created_at: Date;
  updated_at: Date;
}

const fromRow = (r: Row): Order => ({
  id: r.id,
  customerId: r.customer_id,
  amountKop: Number(r.amount_kop),
  paidKop: r.paid_kop === null ? null : Number(r.paid_kop),
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export class OrdersRepository {
  constructor(private readonly db: Db) {}

  /**
   * Сохраняет версию заказа, только если она новее сохранённой (по updated_at).
   * Проверка и запись — одним запросом: при параллельных вебхуках старая версия не затрёт новую.
   * Та же версия принимается ещё раз, если у сохранённой строки нет paid_kop (строка до миграции 002):
   * так повторный синк дозаполняет оплаченные суммы.
   */
  async saveIfNewer(o: Order): Promise<"created" | "updated" | "stale"> {
    const { rows } = await this.db.query<{ inserted: boolean }>(
      `INSERT INTO orders (id, customer_id, amount_kop, paid_kop, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         customer_id = excluded.customer_id,
         amount_kop  = excluded.amount_kop,
         paid_kop    = excluded.paid_kop,
         status      = excluded.status,
         created_at  = excluded.created_at,
         updated_at  = excluded.updated_at
       WHERE orders.updated_at < excluded.updated_at
          OR (orders.updated_at = excluded.updated_at AND orders.paid_kop IS NULL AND excluded.paid_kop IS NOT NULL)
       RETURNING (xmax = 0) AS inserted`,
      [o.id, o.customerId, o.amountKop, o.paidKop, o.status, o.createdAt, o.updatedAt],
    );
    if (rows.length === 0) return "stale";
    return rows[0].inserted ? "created" : "updated";
  }

  /** Оплаченные заказы клиента, созданные в [from, to). */
  async paidCreatedBetween(customerId: string, from: Date, to: Date): Promise<Order[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM orders
        WHERE customer_id = $1 AND status = 'paid' AND created_at >= $2 AND created_at < $3`,
      [customerId, from, to],
    );
    return rows.map(fromRow);
  }
}
