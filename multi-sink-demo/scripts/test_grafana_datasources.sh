#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

AUTH_HEADER="${GRAFANA_AUTH_HEADER:-Authorization: Basic YWRtaW46YWRtaW4=}"

check_datasource() {
  local name="$1"
  local uid="$2"
  local response

  response="$(
    docker compose exec -T grafana sh -lc \
      "curl -fsS -H '$AUTH_HEADER' http://127.0.0.1:3000/api/datasources/uid/$uid/health"
  )"

  if ! grep -q '"status":"OK"' <<<"$response"; then
    echo "[FAIL] $name datasource health failed: $response" >&2
    return 1
  fi

  echo "[OK] $name datasource health: $response"
}

check_datasource "Prometheus" "demo-prometheus"
check_datasource "Loki" "demo-loki"
check_datasource "InfluxDB" "demo-influxdb"
check_datasource "PostgreSQL" "demo-postgresql"
check_datasource "ClickHouse" "demo-clickhouse"
check_datasource "Elasticsearch" "demo-elasticsearch"

echo
echo "[OK] All Grafana datasources are reachable from Grafana."
echo
echo "Manual UI path:"
echo "  http://127.0.0.1:3000"
echo "  user: admin"
echo "  password: admin"
echo
echo "Open Explore and select each datasource with the sample queries documented in README_TR.md."
