// Выгружает все заказы из внешнего API напрямую, в обход сервиса.
// Использование: node crawl-orders.mjs <out.json> [baseUrl]
// Пишет заказы в <out.json> и лог страниц в <out>.pages.json (видны rate limit и конец пагинации).
import { writeFileSync } from "node:fs";

const [out, base = process.env.ORDERS_API_URL ?? "http://localhost:4000"] = process.argv.slice(2);
if (!out) throw new Error("usage: crawl-orders.mjs <out.json> [baseUrl]");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const orders = [];
const pages = [];
let cursor = null;

for (;;) {
  const url = new URL("/orders", base);
  url.searchParams.set("limit", "100");
  if (cursor) url.searchParams.set("cursor", cursor);

  let body;
  for (;;) {
    await sleep(260); // лимит API — 5 rps
    const res = await fetch(url);
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    // Превышение лимита: 429 или 200 с { error: "rate_limited" }
    if (res.status === 429 || res.status >= 500 || !body || body.error) {
      pages.push({ cursor, status: res.status, error: body?.error ?? text.slice(0, 100) });
      continue;
    }
    break;
  }

  pages.push({ cursor, items: body.items.length, nextCursor: body.nextCursor });
  orders.push(...body.items);
  // Конец: nextCursor = null или пустая страница с тем же курсором
  if (!body.nextCursor || body.items.length === 0) break;
  cursor = body.nextCursor;
}

writeFileSync(out, JSON.stringify(orders, null, 1));
writeFileSync(out.replace(/\.json$/, "") + ".pages.json", JSON.stringify(pages, null, 1));
const ids = new Set(orders.map((o) => o.id));
console.log(`orders: ${orders.length} (unique ${ids.size}), pages: ${pages.filter((p) => "items" in p).length}, rate limited: ${pages.filter((p) => p.error).length}`);
