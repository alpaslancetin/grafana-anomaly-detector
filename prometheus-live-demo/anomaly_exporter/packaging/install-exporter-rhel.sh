#!/usr/bin/env bash
set -euo pipefail

SOURCE_PROM_URL="${1:-http://127.0.0.1:9090}"
SERVICE_NAME="grafana-anomaly-exporter"
SERVICE_USER="${EXPORTER_USER:-grafana-anomaly}"
SERVICE_GROUP="${EXPORTER_GROUP:-grafana-anomaly}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/grafana-anomaly-exporter}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/grafana-anomaly-exporter}"
STATE_ROOT="${STATE_ROOT:-/var/lib/grafana-anomaly-exporter}"
LOG_ROOT="${LOG_ROOT:-/var/log/grafana-anomaly-exporter}"
EXPORTER_LISTEN_HOST="${EXPORTER_LISTEN_HOST:-127.0.0.1}"
EXPORTER_LISTEN_PORT="${EXPORTER_LISTEN_PORT:-9110}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Bu script root olarak calismalidir. Ornek: sudo ./install-exporter-rhel.sh http://127.0.0.1:9090" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y python3 python3-pip
  else
    echo "python3 bulunamadi. Lutfen python3 kur ve tekrar dene." >&2
    exit 1
  fi
fi

if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)'; then
  echo "Python 3.9 veya daha yeni bir surum gereklidir. Bulunan: $(python3 --version 2>&1)" >&2
  exit 1
fi

if ! python3 -m venv --help >/dev/null 2>&1; then
  echo "python3 -m venv kullanilamiyor. Lutfen python3-venv benzeri paketi kur." >&2
  exit 1
fi

if ! getent group "$SERVICE_GROUP" >/dev/null 2>&1; then
  groupadd --system "$SERVICE_GROUP"
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --gid "$SERVICE_GROUP" --home-dir "$STATE_ROOT" --shell /sbin/nologin "$SERVICE_USER"
fi

mkdir -p "$INSTALL_ROOT" "$CONFIG_ROOT" "$STATE_ROOT" "$LOG_ROOT"
rm -rf "$INSTALL_ROOT/app"
mkdir -p "$INSTALL_ROOT/app"
cp -R "$SCRIPT_DIR/exporter/app" "$INSTALL_ROOT/"
cp "$SCRIPT_DIR/exporter/main.py" "$INSTALL_ROOT/main.py"
cp "$SCRIPT_DIR/exporter/requirements.txt" "$INSTALL_ROOT/requirements.txt"
if [[ -f "$SCRIPT_DIR/exporter/requirements-postgresql.txt" ]]; then
  cp "$SCRIPT_DIR/exporter/requirements-postgresql.txt" "$INSTALL_ROOT/requirements-postgresql.txt"
fi

if [[ ! -d "$INSTALL_ROOT/.venv" ]]; then
  python3 -m venv "$INSTALL_ROOT/.venv"
fi
"$INSTALL_ROOT/.venv/bin/pip" install -q --disable-pip-version-check -r "$INSTALL_ROOT/requirements.txt"
case "${INSTALL_POSTGRESQL_SINK:-false}" in
  true|TRUE|1|yes|YES)
    if [[ -f "$INSTALL_ROOT/requirements-postgresql.txt" ]]; then
      "$INSTALL_ROOT/.venv/bin/pip" install -q --disable-pip-version-check -r "$INSTALL_ROOT/requirements-postgresql.txt"
    fi
    ;;
esac

if [[ ! -f "$CONFIG_ROOT/config.yml" ]]; then
  cp "$SCRIPT_DIR/exporter/config.yml" "$CONFIG_ROOT/config.yml"
fi

if [[ ! -f "$CONFIG_ROOT/exporter.env" ]]; then
cat > "$CONFIG_ROOT/exporter.env" <<EOF
ANOMALY_CONFIG_PATH=$CONFIG_ROOT/config.yml
ANOMALY_DYNAMIC_RULES_PATH=$STATE_ROOT/dynamic_rules.json
ANOMALY_PROMETHEUS_URL=$SOURCE_PROM_URL
ANOMALY_LISTEN_HOST=$EXPORTER_LISTEN_HOST
ANOMALY_LISTEN_PORT=$EXPORTER_LISTEN_PORT
ANOMALY_EVALUATION_INTERVAL_SECONDS=10
ANOMALY_REQUEST_TIMEOUT_SECONDS=10
ANOMALY_CONFIG_RELOAD_INTERVAL_SECONDS=10

# Optional multi-datasource sink overrides. Keep disabled unless needed.
# ANOMALY_SINK_LOKI_ENABLED=false
# ANOMALY_SINK_LOKI_URL=http://127.0.0.1:3100
# ANOMALY_SINK_INFLUX_ENABLED=false
# ANOMALY_SINK_INFLUX_URL=http://127.0.0.1:8086
# ANOMALY_SINK_INFLUX_ORG=anomaly
# ANOMALY_SINK_INFLUX_BUCKET=anomaly
# ANOMALY_SINK_INFLUX_TOKEN=
# ANOMALY_SINK_PG_ENABLED=false
# ANOMALY_SINK_PG_DSN=postgresql://anomaly:anomaly@127.0.0.1:5432/anomaly
# ANOMALY_SINK_CH_ENABLED=false
# ANOMALY_SINK_CH_URL=http://127.0.0.1:8123
# ANOMALY_SINK_ES_ENABLED=false
# ANOMALY_SINK_ES_URL=http://127.0.0.1:9200
EOF
fi

# Keep edited credentials/endpoints on upgrade; install sample configs separately.
mkdir -p "$CONFIG_ROOT/examples"
cp "$SCRIPT_DIR/exporter/examples/"*.yml "$CONFIG_ROOT/examples/"

cp "$SCRIPT_DIR/grafana-anomaly-exporter.service" "/etc/systemd/system/$SERVICE_NAME.service"

chmod 755 "$INSTALL_ROOT" "$INSTALL_ROOT/main.py"
chmod 640 "$CONFIG_ROOT/exporter.env"
chown -R root:root "$INSTALL_ROOT" "$CONFIG_ROOT"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$STATE_ROOT" "$LOG_ROOT"

if command -v restorecon >/dev/null 2>&1; then
  restorecon -R "$INSTALL_ROOT" "$CONFIG_ROOT" "$STATE_ROOT" "$LOG_ROOT" >/dev/null 2>&1 || true
  restorecon "/etc/systemd/system/$SERVICE_NAME.service" >/dev/null 2>&1 || true
fi

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"

echo "Exporter kuruldu ve servis baslatildi."
echo "Service: $SERVICE_NAME"
echo "Bind address: $EXPORTER_LISTEN_HOST:$EXPORTER_LISTEN_PORT"
echo "Metrics endpoint: http://127.0.0.1:$EXPORTER_LISTEN_PORT/metrics"
echo "Config: $CONFIG_ROOT/exporter.env"
if [[ "$EXPORTER_LISTEN_HOST" != "127.0.0.1" ]]; then
  echo "Not: remote Prometheus scrape edecekse firewall ve SELinux izinlerini kontrol et."
fi
echo "Prometheus hedefi kullaniyorsan scrape job ekle. InfluxDB source/sink icin Prometheus zorunlu degildir."
