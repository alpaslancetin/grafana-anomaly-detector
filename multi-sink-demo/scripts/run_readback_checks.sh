#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

wait_for() {
  local name="$1"
  local url="$2"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[OK] $name is reachable"
      return 0
    fi
    sleep 2
  done
  echo "[FAIL] $name did not become reachable: $url" >&2
  return 1
}

wait_for "exporter" "http://127.0.0.1:9110/health"
wait_for "prometheus" "http://127.0.0.1:9091/-/ready"
wait_for "loki" "http://127.0.0.1:3100/ready"
wait_for "influxdb" "http://127.0.0.1:8086/health"
wait_for "clickhouse" "http://127.0.0.1:8123/ping"
wait_for "elasticsearch" "http://127.0.0.1:9200"

grafana_ready=0
for _ in $(seq 1 60); do
  if docker compose exec -T grafana sh -lc 'wget -qO- http://127.0.0.1:3000/api/health >/dev/null' >/dev/null 2>&1; then
    echo "[OK] grafana is reachable"
    grafana_ready=1
    break
  fi
  sleep 2
done
if [[ "$grafana_ready" -ne 1 ]]; then
  echo "[FAIL] grafana did not become reachable inside its container" >&2
  exit 1
fi

postgres_ready=0
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U anomaly -d anomaly >/dev/null 2>&1; then
    echo "[OK] postgres is reachable"
    postgres_ready=1
    break
  fi
  sleep 2
done
if [[ "$postgres_ready" -ne 1 ]]; then
  echo "[FAIL] postgres did not become reachable" >&2
  exit 1
fi

echo "[INFO] Waiting for at least one exporter evaluation cycle"
sleep 20

echo "[INFO] Running canonical panel/exporter parity check"
python3 ../scripts/parity_check.py

echo "[INFO] Publishing plugin-computed source/target matrix"
./scripts/publish_plugin_score_feed_matrix.sh

echo "[INFO] Waiting for async sink writes"
sleep 8

alerts_json="$(docker compose exec -T grafana sh -lc 'wget -qO- --header "Authorization: Basic YWRtaW46YWRtaW4=" http://127.0.0.1:3000/api/v1/provisioning/alert-rules')"
for alert_uid in ms-prom-score ms-loki-score ms-influx-score ms-postgres-score ms-clickhouse-score ms-elastic-score ms-sink-watchdog; do
  if ! grep -q "\"uid\":\"$alert_uid\"" <<<"$alerts_json"; then
    echo "[FAIL] Grafana alert provisioning did not expose $alert_uid" >&2
    exit 1
  fi
done
if grep -q '"noDataState":"OK"\|"execErrState":"OK"\|"for":"0s"' <<<"$alerts_json"; then
  echo "[FAIL] Grafana alert provisioning still has silent-blindness or flapping-prone defaults" >&2
  exit 1
fi
echo "[OK] Grafana alert rule examples and sink watchdog are provisioned with safe states"

metrics_payload="$(curl -fsS "http://127.0.0.1:9110/metrics")"
grep -q "grafana_anomaly_rule_score" <<<"$metrics_payload"
grep -q 'grafana_anomaly_sink_up{sink="loki"} 1' <<<"$metrics_payload"
echo "[OK] Prometheus exposition contains anomaly and sink metrics"

for source in prometheus loki influxdb postgresql clickhouse elasticsearch; do
  for target in prometheus loki influxdb postgresql clickhouse elasticsearch; do
    if ! grep -q "rule=\"matrix_${source}_to_${target}\"" <<<"$metrics_payload"; then
      echo "[FAIL] Prometheus metrics missing matrix_${source}_to_${target}" >&2
      exit 1
    fi
  done
done
echo "[OK] Prometheus metrics contain all plugin-computed matrix rules"

loki_count_response="$(curl -fsSG "http://127.0.0.1:3100/loki/api/v1/query" --data-urlencode 'query=count_over_time({job="grafana_anomaly_exporter"}[30m])')"
loki_count="$(grep -o '"value":\[[^]]*\]' <<<"$loki_count_response" | head -n 1 || true)"
if [[ -z "$loki_count" ]]; then
  echo "[FAIL] Loki read-back returned no anomaly feed records" >&2
  exit 1
fi
echo "[OK] Loki read-back returned records"

loki_matrix="$(curl -fsSG "http://127.0.0.1:3100/loki/api/v1/query" --data-urlencode 'query={job="grafana_anomaly_exporter",record_type="rule"}')"
for source in prometheus loki influxdb postgresql clickhouse elasticsearch; do
  if ! grep -q "matrix_${source}_to_loki" <<<"$loki_matrix"; then
    echo "[FAIL] Loki read-back missing matrix_${source}_to_loki" >&2
    exit 1
  fi
done
echo "[OK] Loki read-back contains plugin-computed matrix records"

loki_end_ns="$(date +%s%N)"
loki_start_ns="$((loki_end_ns - 1800 * 1000000000))"
loki_unwrap_matrix="$(
  curl -fsSG "http://127.0.0.1:3100/loki/api/v1/query_range" \
    --data-urlencode 'query=max_over_time({job="grafana_anomaly_exporter",record_type="series",rule="checkout_latency"} | json normalized_score="normalized_score" | unwrap normalized_score [1m])' \
    --data-urlencode "start=$loki_start_ns" \
    --data-urlencode "end=$loki_end_ns" \
    --data-urlencode 'step=60'
)"
if ! grep -q '"resultType":"matrix"' <<<"$loki_unwrap_matrix" || ! grep -q '"values":\[\[' <<<"$loki_unwrap_matrix"; then
  echo "[FAIL] Loki unwrap query_range did not return a numeric matrix" >&2
  echo "$loki_unwrap_matrix" >&2
  exit 1
fi
echo "[OK] Loki unwrap query_range returns numeric matrix"

influx_payload='{"query":"from(bucket: \"anomaly\") |> range(start: -30m) |> filter(fn: (r) => r._measurement == \"grafana_anomaly\" and r._field == \"score\") |> count()"}'
influx_count_response="$(curl -fsS "http://127.0.0.1:8086/api/v2/query?org=anomaly" \
  -H "Authorization: Token anomaly-demo-token" \
  -H "Content-Type: application/json" \
  --data "$influx_payload")"
if ! grep -q ",_value" <<<"$influx_count_response"; then
  echo "[FAIL] InfluxDB read-back returned no score points" >&2
  echo "$influx_count_response" >&2
  exit 1
fi
echo "[OK] InfluxDB read-back returned score points"

influx_matrix_payload='{"query":"from(bucket: \"anomaly\") |> range(start: -30m) |> filter(fn: (r) => r._measurement == \"grafana_anomaly\" and r._field == \"score\" and r.record_type == \"rule\" and r.rule =~ /^matrix_.*_to_influxdb$/) |> count()"}'
influx_matrix="$(curl -fsS "http://127.0.0.1:8086/api/v2/query?org=anomaly" \
  -H "Authorization: Token anomaly-demo-token" \
  -H "Content-Type: application/json" \
  --data "$influx_matrix_payload")"
if ! grep -q "_to_influxdb" <<<"$influx_matrix"; then
  echo "[FAIL] InfluxDB read-back returned no plugin-computed matrix records" >&2
  echo "$influx_matrix" >&2
  exit 1
fi
echo "[OK] InfluxDB read-back contains plugin-computed matrix records"

pg_count="$(docker compose exec -T postgres psql -U anomaly -d anomaly -tAc 'SELECT count(*) FROM grafana_anomaly_scores;' | tr -d '[:space:]')"
if [[ "${pg_count:-0}" -le 0 ]]; then
  echo "[FAIL] PostgreSQL read-back returned $pg_count records" >&2
  exit 1
fi
echo "[OK] PostgreSQL read-back returned $pg_count records"

pg_matrix_count="$(docker compose exec -T postgres psql -U anomaly -d anomaly -tAc "SELECT count(*) FROM grafana_anomaly_scores WHERE record_type = 'rule' AND rule LIKE 'matrix_%_to_postgresql';" | tr -d '[:space:]')"
if [[ "${pg_matrix_count:-0}" -lt 6 ]]; then
  echo "[FAIL] PostgreSQL read-back returned $pg_matrix_count plugin-computed matrix records" >&2
  exit 1
fi
echo "[OK] PostgreSQL read-back contains $pg_matrix_count plugin-computed matrix records"

ch_count="$(curl -fsS "http://127.0.0.1:8123/?query=SELECT%20count()%20FROM%20default.grafana_anomaly_scores" | tr -d '[:space:]')"
if [[ "${ch_count:-0}" -le 0 ]]; then
  echo "[FAIL] ClickHouse read-back returned $ch_count records" >&2
  exit 1
fi
echo "[OK] ClickHouse read-back returned $ch_count records"

ch_matrix_count="$(curl -fsS "http://127.0.0.1:8123/?query=SELECT%20count()%20FROM%20default.grafana_anomaly_scores%20WHERE%20record_type%3D%27rule%27%20AND%20startsWith%28rule%2C%27matrix_%27%29%20AND%20endsWith%28rule%2C%27_to_clickhouse%27%29" | tr -d '[:space:]')"
if [[ "${ch_matrix_count:-0}" -lt 6 ]]; then
  echo "[FAIL] ClickHouse read-back returned $ch_matrix_count plugin-computed matrix records" >&2
  exit 1
fi
echo "[OK] ClickHouse read-back contains $ch_matrix_count plugin-computed matrix records"

es_count_response="$(curl -fsS "http://127.0.0.1:9200/grafana-anomaly-*/_count")"
es_count="$(grep -o '"count":[0-9]*' <<<"$es_count_response" | head -n 1 | cut -d: -f2)"
if [[ "${es_count:-0}" -le 0 ]]; then
  echo "[FAIL] Elasticsearch read-back returned $es_count records" >&2
  exit 1
fi
echo "[OK] Elasticsearch read-back returned $es_count records"

curl -fsS -X POST "http://127.0.0.1:9200/grafana-anomaly-*/_refresh" >/dev/null
es_matrix_response="$(curl -fsS "http://127.0.0.1:9200/grafana-anomaly-*/_count" \
  -H "Content-Type: application/json" \
  --data '{"query":{"query_string":{"query":"record_type:rule AND rule:matrix_*_to_elasticsearch"}}}')"
es_matrix_count="$(grep -o '"count":[0-9]*' <<<"$es_matrix_response" | head -n 1 | cut -d: -f2)"
if [[ "${es_matrix_count:-0}" -lt 6 ]]; then
  echo "[FAIL] Elasticsearch read-back returned $es_matrix_count plugin-computed matrix records" >&2
  exit 1
fi
echo "[OK] Elasticsearch read-back contains $es_matrix_count plugin-computed matrix records"

echo "[OK] Multi-sink read-back checks passed"
