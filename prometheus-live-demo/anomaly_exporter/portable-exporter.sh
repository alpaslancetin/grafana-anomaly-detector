#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/main.py" ]]; then
  EXPORTER_DIR="$SCRIPT_DIR"
else
  EXPORTER_DIR="$SCRIPT_DIR/exporter"
fi

RUNTIME_DIR="$SCRIPT_DIR/.portable-runtime"
PID_FILE="$RUNTIME_DIR/exporter.pid"
LOG_FILE="$RUNTIME_DIR/exporter.log"
ENV_FILE="$RUNTIME_DIR/exporter.env"
CONFIG_PATH="${ANOMALY_CONFIG_PATH:-$EXPORTER_DIR/config.yml}"
DYNAMIC_RULES_PATH="${ANOMALY_DYNAMIC_RULES_PATH:-$RUNTIME_DIR/dynamic_rules.json}"
PYTHON_BIN="${ANOMALY_PYTHON_BIN:-python3}"

COMMAND="${1:-help}"
PROM_URL="${2:-${ANOMALY_PROMETHEUS_URL:-http://127.0.0.1:9090}}"
LISTEN_HOST="${ANOMALY_LISTEN_HOST:-0.0.0.0}"
LISTEN_PORT="${ANOMALY_LISTEN_PORT:-9110}"
EVALUATION_INTERVAL="${ANOMALY_EVALUATION_INTERVAL_SECONDS:-10}"
REQUEST_TIMEOUT="${ANOMALY_REQUEST_TIMEOUT_SECONDS:-10}"
RELOAD_INTERVAL="${ANOMALY_CONFIG_RELOAD_INTERVAL_SECONDS:-10}"

print_usage() {
  cat <<'EOF'
Usage:
  ./portable-exporter.sh validate
  ./portable-exporter.sh start [PROMETHEUS_URL]
  ./portable-exporter.sh stop
  ./portable-exporter.sh restart [PROMETHEUS_URL]
  ./portable-exporter.sh status
  ./portable-exporter.sh logs
  ./portable-exporter.sh foreground [PROMETHEUS_URL]

Prometheus example:
  cp exporter/examples/config.prometheus.yml exporter/config.yml
  ./portable-exporter.sh validate
  ./portable-exporter.sh start http://127.0.0.1:9090

InfluxDB example:
  cp exporter/examples/config.influxdb.yml exporter/config.yml
  export ANOMALY_SOURCE_INFLUX_ORG=my-org
  export ANOMALY_SOURCE_INFLUX_TOKEN=source-token
  export ANOMALY_SINK_INFLUX_TOKEN=sink-token
  ./portable-exporter.sh validate
  ./portable-exporter.sh start

Overrides:
  ANOMALY_CONFIG_PATH     default: exporter/config.yml
  ANOMALY_PYTHON_BIN      default: python3
  ANOMALY_LISTEN_HOST     default: 0.0.0.0
  ANOMALY_LISTEN_PORT     default: 9110
EOF
}

require_python() {
  if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    echo "$PYTHON_BIN not found. Install Python 3.9 or later." >&2
    return 1
  fi

  if ! "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)'; then
    echo "Python 3.9 or later is required: $PYTHON_BIN" >&2
    return 1
  fi
}

require_config() {
  if [[ ! -f "$CONFIG_PATH" ]]; then
    echo "Exporter config not found: $CONFIG_PATH" >&2
    echo "Copy exporter/examples/config.prometheus.yml or config.influxdb.yml to exporter/config.yml, then edit it." >&2
    return 1
  fi
}

ensure_runtime_dirs() {
  mkdir -p "$RUNTIME_DIR"
}

persist_runtime_env() {
  cat >"$ENV_FILE" <<EOF
PROM_URL=$PROM_URL
LISTEN_HOST=$LISTEN_HOST
LISTEN_PORT=$LISTEN_PORT
EVALUATION_INTERVAL=$EVALUATION_INTERVAL
REQUEST_TIMEOUT=$REQUEST_TIMEOUT
RELOAD_INTERVAL=$RELOAD_INTERVAL
CONFIG_PATH=$CONFIG_PATH
DYNAMIC_RULES_PATH=$DYNAMIC_RULES_PATH
EOF
}

load_persisted_runtime_env() {
  if [[ -f "$ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
  fi
}

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

wait_for_health() {
  if ! command -v curl >/dev/null 2>&1; then
    sleep 2
    is_running
    return
  fi

  for _ in {1..20}; do
    if ! is_running; then
      return 1
    fi
    if curl -fsS "http://127.0.0.1:$LISTEN_PORT/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

export_runtime_env() {
  export ANOMALY_CONFIG_PATH="$CONFIG_PATH"
  export ANOMALY_DYNAMIC_RULES_PATH="$DYNAMIC_RULES_PATH"
  export ANOMALY_PROMETHEUS_URL="$PROM_URL"
  export ANOMALY_LISTEN_HOST="$LISTEN_HOST"
  export ANOMALY_LISTEN_PORT="$LISTEN_PORT"
  export ANOMALY_EVALUATION_INTERVAL_SECONDS="$EVALUATION_INTERVAL"
  export ANOMALY_REQUEST_TIMEOUT_SECONDS="$REQUEST_TIMEOUT"
  export ANOMALY_CONFIG_RELOAD_INTERVAL_SECONDS="$RELOAD_INTERVAL"
}

validate_config() {
  require_python
  require_config
  (
    cd "$EXPORTER_DIR"
    ANOMALY_CONFIG_PATH="$CONFIG_PATH" "$PYTHON_BIN" -c 'import os; from app.config_loader import load_config; config = load_config(os.environ["ANOMALY_CONFIG_PATH"]); print(f"Config OK: rules={len(config.rules)} sinks={len(config.sinks)}")'
  )
}

start_exporter() {
  if is_running; then
    echo "Portable exporter is already running. PID=$(cat "$PID_FILE")"
    return 0
  fi

  require_python
  require_config
  validate_config
  ensure_runtime_dirs
  persist_runtime_env
  export_runtime_env

  (
    cd "$EXPORTER_DIR"
    nohup "$PYTHON_BIN" main.py >>"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
  )

  if wait_for_health; then
    echo "Portable exporter started."
    echo "PID: $(cat "$PID_FILE")"
    echo "Config: $CONFIG_PATH"
    echo "Prometheus: $PROM_URL"
    echo "Endpoint: http://$LISTEN_HOST:$LISTEN_PORT"
    echo "Log: $LOG_FILE"
    return 0
  fi

  echo "Portable exporter did not become healthy. Last log lines:" >&2
  tail -n 40 "$LOG_FILE" >&2 || true
  stop_exporter >/dev/null 2>&1 || true
  return 1
}

stop_exporter() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "Portable exporter is already stopped."
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" >/dev/null 2>&1 || true

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      rm -f "$PID_FILE"
      echo "Portable exporter stopped."
      return 0
    fi
    sleep 1
  done

  echo "Process may still be running. Stop it manually if necessary: kill $pid" >&2
  return 1
}

status_exporter() {
  load_persisted_runtime_env
  if is_running; then
    echo "Portable exporter is running. PID=$(cat "$PID_FILE")"
    echo "Config: $CONFIG_PATH"
    echo "Prometheus: $PROM_URL"
    echo "Endpoint: http://$LISTEN_HOST:$LISTEN_PORT"
    if command -v curl >/dev/null 2>&1; then
      echo
      curl -fsS "http://127.0.0.1:$LISTEN_PORT/api/sync/rules" || true
      echo
    fi
    return 0
  fi

  echo "Portable exporter is not running."
  return 1
}

logs_exporter() {
  ensure_runtime_dirs
  touch "$LOG_FILE"
  tail -n 100 -f "$LOG_FILE"
}

foreground_exporter() {
  require_python
  require_config
  validate_config
  ensure_runtime_dirs
  persist_runtime_env
  export_runtime_env
  cd "$EXPORTER_DIR"
  exec "$PYTHON_BIN" main.py
}

case "$COMMAND" in
  validate)
    validate_config
    ;;
  start)
    start_exporter
    ;;
  stop)
    stop_exporter
    ;;
  restart)
    stop_exporter
    start_exporter
    ;;
  status)
    status_exporter
    ;;
  logs)
    logs_exporter
    ;;
  foreground)
    foreground_exporter
    ;;
  help|-h|--help)
    print_usage
    ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    print_usage >&2
    exit 1
    ;;
esac
