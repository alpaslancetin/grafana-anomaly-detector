#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="grafana-anomaly-exporter"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/grafana-anomaly-exporter}"
CONFIG_ROOT="${CONFIG_ROOT:-/etc/grafana-anomaly-exporter}"
STATE_ROOT="${STATE_ROOT:-/var/lib/grafana-anomaly-exporter}"
LOG_ROOT="${LOG_ROOT:-/var/log/grafana-anomaly-exporter}"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Bu script root olarak calismalidir." >&2
  exit 1
fi

systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
rm -f "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
rm -rf "$INSTALL_ROOT" "$CONFIG_ROOT" "$STATE_ROOT" "$LOG_ROOT"

echo "Exporter kaldirildi."
echo "Not: prometheus scrape job varsa onu da ayri temizlemelisin."
