import { describe, expect, it } from "vitest";
import { fromKop, parseRub, toKop } from "../src/utils/money.js";

describe("parseRub", () => {
  it("принимает число и строку с числом", () => {
    expect(parseRub(2500)).toBe(2500);
    expect(parseRub("2500.00")).toBe(2500);
    expect(parseRub(" 99 ")).toBe(99);
  });

  it("отклоняет мусор и отрицательные суммы", () => {
    expect(() => parseRub("abc")).toThrow();
    expect(() => parseRub(null)).toThrow();
    expect(() => parseRub(-1)).toThrow();
  });

  it("пустая строка — не ноль рублей", () => {
    // Number("") === 0: без явной проверки пустая сумма превращалась в бесплатный заказ
    expect(() => parseRub("")).toThrow();
    expect(() => parseRub("   ")).toThrow();
  });

  it("строка — только обычное десятичное число", () => {
    // Number() понимает и такое, но суммы так не пишут
    expect(() => parseRub("0x10")).toThrow();
    expect(() => parseRub("1e3")).toThrow();
    expect(() => parseRub("Infinity")).toThrow();
    expect(() => parseRub("12,50")).toThrow();
    expect(parseRub("0.5")).toBe(0.5);
    expect(parseRub("0")).toBe(0);
  });
});

describe("toKop / fromKop", () => {
  it("рубли в копейки", () => {
    expect(toKop(2500)).toBe(250000);
    expect(toKop(99)).toBe(9900);
  });

  it("отбрасывает доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
  });

  it("не теряет копейку из-за погрешности float", () => {
    // Реальные amountPaid из внешнего API: x * 100 в float чуть меньше целого
    expect(toKop(4723.9)).toBe(472390);
    expect(toKop(1217.61)).toBe(121761);
    expect(toKop(2379.2)).toBe(237920);
    expect(toKop(0.29)).toBe(29);
  });

  it("копейки в рубли", () => {
    expect(fromKop(250000)).toBe(2500);
    expect(fromKop(1099)).toBe(10.99);
  });
});
