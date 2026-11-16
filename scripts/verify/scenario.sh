#!/usr/bin/env bash
# Сценарий из TASK.md: чистая БД -> сервис -> POST /sync -> вебхуки -> daily-totals.
# Использование: scripts/verify/scenario.sh <out.json> [customerId] [from] [to]
# Внимание: пересоздаёт контейнеры docker compose этого проекта вместе с томами (данные БД удаляются).
set -euo pipefail

OUT=$1
CUSTOMER=${2:-c_7}
FROM=${3:-2026-03-27}
TO=${4:-2026-03-31}

cd "$(dirname "$0")/../.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
PORT=${PORT:-3000}
LOG=scripts/verify/out/server.log

# 1. Чистая БД
docker compose down -v >/dev/null 2>&1
docker compose up -d >/dev/null 2>&1
for _ in $(seq 1 60); do
  # orders_test создаёт init-скрипт: когда она есть, инициализация postgres закончена
  if docker compose exec -T postgres psql -U postgres -lqt 2>/dev/null | grep -q orders_test; then break; fi
  sleep 1
done
docker compose exec -T postgres pg_isready -U postgres -q
npm run -s migrate >/dev/null

# 2. Сервис
node --import tsx src/server.ts > "$LOG" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do curl -sf "localhost:$PORT/health" >/dev/null && break; sleep 0.2; done

# 3. Синк до завершения: /sync отвечает, когда забраны все страницы
echo "sync: $(curl -sf -X POST "localhost:$PORT/sync")"

# 4. Вебхуки до завершения
docker compose run --rm orders-api webhooks --target "http://host.docker.internal:$PORT/webhooks/order" 2>/dev/null | tail -1

# 5. Ответ
curl -sf "localhost:$PORT/customers/$CUSTOMER/daily-totals?from=$FROM&to=$TO" > "$OUT"
echo "saved: $OUT"
