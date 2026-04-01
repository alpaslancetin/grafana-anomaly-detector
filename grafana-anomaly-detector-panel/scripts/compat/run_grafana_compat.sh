#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <grafana-version> <http-port> [dashboard-mode]" >&2
  echo "dashboard-mode: testdata | live" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PANEL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT_DIR="$(cd "$PANEL_DIR/.." && pwd)"
COMPAT_DIR="$ROOT_DIR/.compat"
RUNTIME_ROOT="${GRAFANA_COMPAT_RUNTIME_ROOT:-/root/grafana-compat}"
GRAFANA_VERSION="$1"
HTTP_PORT="$2"
DASHBOARD_MODE="${3:-testdata}"
RUNTIME_DIR="$RUNTIME_ROOT/grafana-${GRAFANA_VERSION//./_}-${DASHBOARD_MODE}"
GRAFANA_HOME="$COMPAT_DIR/grafana-$GRAFANA_VERSION"

if [[ ! -d "$GRAFANA_HOME" ]]; then
  echo "Grafana runtime not found at $GRAFANA_HOME" >&2
  exit 1
fi

if [[ -f "$RUNTIME_DIR/grafana.pid" ]]; then
  kill "$(cat "$RUNTIME_DIR/grafana.pid")" 2>/dev/null || true
fi

rm -rf "$RUNTIME_DIR"
mkdir -p \
  "$RUNTIME_DIR/plugins" \
  "$RUNTIME_DIR/provisioning/dashboards" \
  "$RUNTIME_DIR/provisioning/datasources" \
  "$RUNTIME_DIR/provisioning/plugins" \
  "$RUNTIME_DIR/provisioning/alerting" \
  "$RUNTIME_DIR/data" \
  "$RUNTIME_DIR/logs"

cp -R "$PANEL_DIR/dist" "$RUNTIME_DIR/plugins/alpas-anomalydetector-panel"
cp "$PANEL_DIR/provisioning/datasources/datasources.yml" "$RUNTIME_DIR/provisioning/datasources/datasources.yml"

if [[ "$DASHBOARD_MODE" == "live" ]]; then
  cp "$PANEL_DIR/provisioning/datasources/prometheus-live.yml" "$RUNTIME_DIR/provisioning/datasources/prometheus-live.yml"
  sed -i 's#http://host.docker.internal:9091#http://127.0.0.1:9091#g' "$RUNTIME_DIR/provisioning/datasources/prometheus-live.yml"
  cp "$PANEL_DIR/provisioning/dashboards/prometheus-live-dashboard.json" "$RUNTIME_DIR/provisioning/dashboards/prometheus-live-dashboard.json"
else
  cp "$PANEL_DIR/provisioning/dashboards/dashboard.json" "$RUNTIME_DIR/provisioning/dashboards/dashboard.json"
fi

cat > "$RUNTIME_DIR/provisioning/dashboards/default.yaml" <<EOF
apiVersion: 1
providers:
  - name: 'anomaly-detector'
    folder: 'Anomaly Demo'
    type: file
    allowUiUpdates: false
    updateIntervalSeconds: 10
    options:
      path: $RUNTIME_DIR/provisioning/dashboards
EOF

cat > "$RUNTIME_DIR/custom.ini" <<EOF
[server]
http_port = $HTTP_PORT

[security]
admin_user = admin
admin_password = admin

[auth.anonymous]
enabled = true
org_role = Admin

[paths]
data = $RUNTIME_DIR/data
logs = $RUNTIME_DIR/logs
plugins = $RUNTIME_DIR/plugins
provisioning = $RUNTIME_DIR/provisioning

[plugins]
allow_loading_unsigned_plugins = alpas-anomalydetector-panel
preinstall_disabled = true
preinstall_auto_update = false

[analytics]
check_for_updates = false
check_for_plugin_updates = false
EOF

cd "$GRAFANA_HOME"
nohup ./bin/grafana-server --homepath "$GRAFANA_HOME" --config "$RUNTIME_DIR/custom.ini" > "$RUNTIME_DIR/grafana.stdout.log" 2>&1 &
echo $! > "$RUNTIME_DIR/grafana.pid"

for _ in {1..120}; do
  if curl -sf "http://127.0.0.1:$HTTP_PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

curl -sf "http://127.0.0.1:$HTTP_PORT/api/health"
