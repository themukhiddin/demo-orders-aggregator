#!/usr/bin/env bash
# Полная проверка: эталон по сырым данным внешнего API против ответа сервиса.
#   1. выгружает все заказы из API напрямую;
#   2. перехватывает вебхуки своим приёмником (и меряет, сколько их шлётся одновременно);
#   3. считает эталон daily-totals независимо от кода сервиса;
#   4. RUNS раз прогоняет сценарий из TASK.md и сравнивает ответ с эталоном.
# Использование: scripts/verify/run.sh   (переменные: CUSTOMER, FROM, TO, RUNS, CAPTURE_PORT)
# Внимание: пересоздаёт контейнеры docker compose этого проекта вместе с томами.
set -euo pipefail

CUSTOMER=${CUSTOMER:-c_7}
FROM=${FROM:-2026-03-27}
TO=${TO:-2026-03-31}
RUNS=${RUNS:-3}
CAPTURE_PORT=${CAPTURE_PORT:-3999}

cd "$(dirname "$0")/../.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
API=${ORDERS_API_URL:-http://localhost:4000}
V=scripts/verify
OUT=$V/out
mkdir -p "$OUT"

docker compose up -d >/dev/null 2>&1
for _ in $(seq 1 30); do curl -sf "$API/customers/$CUSTOMER" >/dev/null && break; sleep 1; done

echo "== 1. Заказы из API"
node "$V/crawl-orders.mjs" "$OUT/orders.json" "$API"

echo "== 2. Вебхуки"
node "$V/capture-webhooks.mjs" "$OUT/webhooks.ndjson" "$CAPTURE_PORT" 300 &
CAPTURE=$!
sleep 1
docker compose run --rm orders-api webhooks --target "http://host.docker.internal:$CAPTURE_PORT/webhooks/order" 2>/dev/null | tail -1
kill -TERM $CAPTURE
wait $CAPTURE || true

echo "== 3. Эталон"
TZ_NAME=$(curl -sf "$API/customers/$CUSTOMER" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).timezone))')
echo "$CUSTOMER: $TZ_NAME"
node "$V/expected.mjs" "$OUT/orders.json" "$OUT/webhooks.ndjson" "$CUSTOMER" "$TZ_NAME" "$FROM" "$TO" > "$OUT/expected.json"
cat "$OUT/expected.json"

echo "== 4. Сервис: $RUNS прогонов сценария"
FAILED=0
for i in $(seq 1 "$RUNS"); do
  "$V/scenario.sh" "$OUT/service-$i.json" "$CUSTOMER" "$FROM" "$TO" >/dev/null
  if node -e '
    const fs = require("fs");
    const [a, b] = process.argv.slice(1).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    if (JSON.stringify(a) === JSON.stringify(b)) process.exit(0);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) console.log("  сервис:", JSON.stringify(a[i]), "\n  эталон:", JSON.stringify(b[i]));
    }
    process.exit(1);
  ' "$OUT/service-$i.json" "$OUT/expected.json"; then
    echo "прогон $i: совпадает с эталоном"
  else
    echo "прогон $i: РАСХОЖДЕНИЕ"
    FAILED=1
  fi
done

if [ -f result.json ]; then
  if cmp -s <(node -e 'console.log(JSON.stringify(require("./result.json")))') "$OUT/expected.json"; then
    echo "result.json: совпадает с эталоном"
  else
    echo "result.json: РАСХОЖДЕНИЕ с эталоном"
    FAILED=1
  fi
fi
exit $FAILED
