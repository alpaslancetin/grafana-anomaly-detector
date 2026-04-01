#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PANEL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT_DIR="$(cd "$PANEL_DIR/.." && pwd)"
COMPAT_DIR="$ROOT_DIR/.compat"
RUNTIME_ROOT="${GRAFANA_COMPAT_RUNTIME_ROOT:-/root/grafana-compat}"
RUNTIME_DIR="$RUNTIME_ROOT/live-deps"
PROM_HOME="$COMPAT_DIR/prometheus-2.53.4"

if [[ ! -d "$PROM_HOME" ]]; then
  echo "Prometheus runtime not found at $PROM_HOME" >&2
  exit 1
fi

mkdir -p "$RUNTIME_DIR"

cat > "$RUNTIME_DIR/prometheus.yml" <<EOF
global:
  scrape_interval: 5s
  evaluation_interval: 5s

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets:
          - 127.0.0.1:9091

  - job_name: synthetic-metrics
    scrape_interval: 5s
    static_configs:
      - targets:
          - 127.0.0.1:9108

  - job_name: anomaly-exporter
    scrape_interval: 5s
    static_configs:
      - targets:
          - 127.0.0.1:9110
EOF

cat > "$RUNTIME_DIR/rules.yml" <<EOF
global:
  prometheus_url: http://127.0.0.1:9091
  evaluation_interval_seconds: 5
  request_timeout_seconds: 10
  listen_host: 0.0.0.0
  listen_port: 9110
  config_reload_interval_seconds: 10

rules:
  - name: checkout_latency
    description: Alert-ready anomaly score for checkout latency.
    query: demo_latency_ms{service="checkout",environment="demo"}
    algorithm: mad
    threshold: 2.4
    baseline_window: 12
    severity_preset: page_first
    aggregation: max
    labels:
      team: platform
      category: latency

  - name: checkout_traffic
    description: Alert-ready anomaly score for checkout request throughput.
    query: demo_requests_per_second{service="checkout",environment="demo"}
    algorithm: ewma
    threshold: 2.1
    baseline_window: 14
    severity_preset: warning_first
    aggregation: max
    labels:
      team: platform
      category: traffic

  - name: checkout_error_rate
    description: Alert-ready anomaly score for checkout error percentage.
    query: demo_error_rate_percent{service="checkout",environment="demo"}
    algorithm: mad
    threshold: 2.6
    baseline_window: 18
    severity_preset: page_first
    aggregation: max
    labels:
      team: platform
      category: error_rate
EOF

mkdir -p "$RUNTIME_DIR/state"

stop_if_running() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    kill "$(cat "$pid_file")" 2>/dev/null || true
    rm -f "$pid_file"
  fi
}

stop_if_running "$RUNTIME_DIR/synthetic.pid"
stop_if_running "$RUNTIME_DIR/prometheus.pid"
stop_if_running "$RUNTIME_DIR/exporter.pid"

nohup python3 "$ROOT_DIR/prometheus-live-demo/synthetic_exporter/synthetic_exporter.py" > "$RUNTIME_DIR/synthetic.log" 2>&1 &
echo $! > "$RUNTIME_DIR/synthetic.pid"

nohup "$PROM_HOME/prometheus" --config.file="$RUNTIME_DIR/prometheus.yml" --web.listen-address="127.0.0.1:9091" --storage.tsdb.path="$RUNTIME_DIR/prometheus-data" > "$RUNTIME_DIR/prometheus.log" 2>&1 &
echo $! > "$RUNTIME_DIR/prometheus.pid"

nohup env \
  ANOMALY_CONFIG_PATH="$RUNTIME_DIR/rules.yml" \
  ANOMALY_DYNAMIC_RULES_PATH="$RUNTIME_DIR/state/dynamic_rules.json" \
  python3 "$ROOT_DIR/prometheus-live-demo/anomaly_exporter/main.py" > "$RUNTIME_DIR/exporter.log" 2>&1 &
echo $! > "$RUNTIME_DIR/exporter.pid"

for _ in {1..60}; do
  ready=0
  curl -sf http://127.0.0.1:9108/metrics >/dev/null 2>&1 && ready=$((ready + 1))
  curl -sf http://127.0.0.1:9091/-/ready >/dev/null 2>&1 && ready=$((ready + 1))
  curl -sf http://127.0.0.1:9110/health >/dev/null 2>&1 && ready=$((ready + 1))
  if [[ "$ready" -eq 3 ]]; then
    break
  fi
  sleep 2
done

curl -sf http://127.0.0.1:9108/metrics >/dev/null
curl -sf http://127.0.0.1:9091/-/ready >/dev/null
curl -sf http://127.0.0.1:9110/health >/dev/null

echo "live dependencies ready"
