#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXPORTER_DIR="$SCRIPT_DIR/exporter"
RUNTIME_DIR="$SCRIPT_DIR/.portable-runtime"
PID_FILE="$RUNTIME_DIR/exporter.pid"
LOG_FILE="$RUNTIME_DIR/exporter.log"
CONFIG_PATH="$EXPORTER_DIR/config.yml"
DYNAMIC_RULES_PATH="$RUNTIME_DIR/dynamic_rules.json"
PYTHON_BIN="${ANOMALY_PYTHON_BIN:-python3}"

COMMAND="${1:-help}"
PROM_URL="${2:-${ANOMALY_SOURCE_PROMETHEUS_URL:-http://127.0.0.1:9090}}"
LISTEN_HOST="${ANOMALY_LISTEN_HOST:-0.0.0.0}"
LISTEN_PORT="${ANOMALY_LISTEN_PORT:-9110}"
EVALUATION_INTERVAL="${ANOMALY_EVALUATION_INTERVAL_SECONDS:-10}"
REQUEST_TIMEOUT="${ANOMALY_REQUEST_TIMEOUT_SECONDS:-10}"
RELOAD_INTERVAL="${ANOMALY_CONFIG_RELOAD_INTERVAL_SECONDS:-10}"

print_usage() {
  cat <<EOF
Kullanim:
  ./portable-exporter.sh start [PROMETHEUS_URL]
  ./portable-exporter.sh stop
  ./portable-exporter.sh restart [PROMETHEUS_URL]
  ./portable-exporter.sh status
  ./portable-exporter.sh logs
  ./portable-exporter.sh foreground [PROMETHEUS_URL]

Ornek:
  ./portable-exporter.sh start http://truva01.turkcell.tgc:9090/

Env override:
  ANOMALY_PYTHON_BIN    varsayilan: python3
  ANOMALY_LISTEN_HOST   varsayilan: 0.0.0.0
  ANOMALY_LISTEN_PORT   varsayilan: 9110
EOF
}

require_python() {
  if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    echo "$PYTHON_BIN bulunamadi. Portable exporter icin python3 gereklidir." >&2
    exit 1
  fi
}

ensure_runtime_dirs() {
  mkdir -p "$RUNTIME_DIR"
}

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    return 1
  fi

  kill -0 "$pid" >/dev/null 2>&1
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

start_exporter() {
  if is_running; then
    echo "Portable exporter zaten calisiyor. PID=$(cat "$PID_FILE")"
    exit 0
  fi

  require_python
  ensure_runtime_dirs
  export_runtime_env

  (
    cd "$EXPORTER_DIR"
    nohup "$PYTHON_BIN" main.py >>"$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
  )

  sleep 1
  if is_running; then
    echo "Portable exporter basladi."
    echo "PID: $(cat "$PID_FILE")"
    echo "Prometheus: $PROM_URL"
    echo "Endpoint: http://$LISTEN_HOST:$LISTEN_PORT"
    echo "Log: $LOG_FILE"
    exit 0
  fi

  echo "Portable exporter baslatilamadi. Son log satirlari:" >&2
  tail -n 40 "$LOG_FILE" >&2 || true
  exit 1
}

stop_exporter() {
  if ! is_running; then
    rm -f "$PID_FILE"
    echo "Portable exporter zaten duruyor."
    exit 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" >/dev/null 2>&1 || true

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      rm -f "$PID_FILE"
      echo "Portable exporter durduruldu."
      exit 0
    fi
    sleep 1
  done

  echo "Process hala calisiyor olabilir. Gerekirse manuel kapat: kill $pid" >&2
  exit 1
}

status_exporter() {
  if is_running; then
    echo "Portable exporter calisiyor. PID=$(cat "$PID_FILE")"
    echo "Prometheus: $PROM_URL"
    echo "Endpoint: http://$LISTEN_HOST:$LISTEN_PORT"
    if command -v curl >/dev/null 2>&1; then
      echo
      curl -fsS "http://127.0.0.1:$LISTEN_PORT/api/sync/rules" || true
      echo
    fi
    exit 0
  fi

  echo "Portable exporter calismiyor."
  exit 1
}

logs_exporter() {
  ensure_runtime_dirs
  touch "$LOG_FILE"
  tail -n 100 -f "$LOG_FILE"
}

foreground_exporter() {
  require_python
  ensure_runtime_dirs
  export_runtime_env
  cd "$EXPORTER_DIR"
  exec "$PYTHON_BIN" main.py
}

case "$COMMAND" in
  start)
    start_exporter
    ;;
  stop)
    stop_exporter
    ;;
  restart)
    stop_exporter || true
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
    echo "Bilinmeyen komut: $COMMAND" >&2
    print_usage >&2
    exit 1
    ;;
esac