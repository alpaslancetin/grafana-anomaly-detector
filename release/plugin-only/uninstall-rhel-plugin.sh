#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="alpas-anomalydetector-panel"
GRAFANA_PLUGIN_ROOT="${GRAFANA_PLUGIN_ROOT:-/var/lib/grafana/plugins}"
TARGET_DIR="$GRAFANA_PLUGIN_ROOT/$PLUGIN_ID"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Bu script root olarak calismalidir. Ornek: sudo ./uninstall-rhel-plugin.sh" >&2
  exit 1
fi

rm -rf "$TARGET_DIR"
systemctl restart grafana-server

echo "Plugin kaldirildi: $TARGET_DIR"
