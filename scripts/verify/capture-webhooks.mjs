// Принимает вебхуки внешней системы вместо сервиса и пишет их в файл по порядку прихода.
// Отвечает с задержкой, чтобы было видно, сколько запросов отправитель шлёт одновременно.
// Использование: node capture-webhooks.mjs <out.ndjson> [port=3999] [delayMs=300]
// Останавливается по SIGTERM/SIGINT и печатает статистику.
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const [out, port = "3999", delay = "300"] = process.argv.slice(2);
if (!out) throw new Error("usage: capture-webhooks.mjs <out.ndjson> [port] [delayMs]");

writeFileSync(out, "");
let received = 0;
let inflight = 0;
let maxInflight = 0;

const server = createServer((req, res) => {
  inflight++;
  maxInflight = Math.max(maxInflight, inflight);
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    appendFileSync(out, JSON.stringify({ i: received++, url: req.url, body: JSON.parse(body) }) + "\n");
    setTimeout(() => {
      inflight--;
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"result":"created"}');
    }, Number(delay));
  });
});

server.listen(Number(port), () => console.log(`capturing webhooks on :${port}`));

const stop = () => {
  console.log(`webhooks captured: ${received}, max concurrent requests: ${maxInflight}`);
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
