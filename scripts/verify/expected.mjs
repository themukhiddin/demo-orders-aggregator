// Эталон daily-totals, посчитанный независимо от кода сервиса — по сырым данным внешнего API.
// Состояние заказа: версия из /orders, поверх — самая свежая по updatedAt версия из вебхуков.
// День — по таймзоне клиента на момент создания заказа (Intl учитывает летнее время).
// Использование: node expected.mjs <orders.json> <webhooks.ndjson> <customerId> <timezone> <from> <to>
import { readFileSync } from "node:fs";

const [ordersFile, webhooksFile, customerId, timeZone, from, to] = process.argv.slice(2);
if (!to) throw new Error("usage: expected.mjs <orders.json> <webhooks.ndjson> <customerId> <timezone> <from> <to>");

// Время без зоны — UTC (так сказано в контракте API)
const utc = (s) => Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : `${s}Z`);
// Рубли → копейки через округление: в данных не больше двух знаков после запятой
const kop = (x) => Math.round(Number(x) * 100);

const state = new Map(JSON.parse(readFileSync(ordersFile, "utf8")).map((o) => [o.id, o]));
const lines = readFileSync(webhooksFile, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
  const o = JSON.parse(line).body;
  const cur = state.get(o.id);
  if (!cur || utc(o.updatedAt) > utc(cur.updatedAt)) state.set(o.id, o);
}

const localDate = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
const days = new Map();
for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
  days.set(new Date(t).toISOString().slice(0, 10), { gross: 0, net: 0 });
}

for (const o of state.values()) {
  if (o.customerId !== customerId || o.status !== "paid") continue;
  const day = days.get(localDate.format(utc(o.createdAt)));
  if (!day) continue;
  day.gross += kop(o.amount);
  day.net += kop(o.amountPaid ?? o.amount);
}

const result = [...days].map(([date, { gross, net }]) => ({
  date,
  total: gross / 100,
  gross: gross / 100,
  discount: (gross - net) / 100,
  net: net / 100,
}));
console.log(JSON.stringify(result));
