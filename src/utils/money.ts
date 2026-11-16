/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * Число из внешнего API: число или строка с десятичным числом ("250.10", " 15 ").
 * Строку проверяем явно: Number() превращает "" в 0, а "0x10" и "1e3" — в 16 и 1000.
 * null — не число.
 */
export function parseDecimal(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && DECIMAL.test(raw.trim())) return Number(raw.trim());
  return null;
}

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const value = parseDecimal(raw);
  if (value === null || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * Рубли → копейки. Доли копейки отбрасываются: деньги клиенту не досчитываем.
 * Перед отбрасыванием убираем погрешность float: 4723.9 * 100 = 472389.99999999994, а не 472390.
 */
export function toKop(rub: number): number {
  return Math.floor(Number((rub * 100).toFixed(6)));
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
