#!/usr/bin/env bash
set -euo pipefail

DEFAULT_PROM_CONFIG="/etc/prometheus/prometheus.yml"
PROM_CONFIG="${PROM_CONFIG:-$DEFAULT_PROM_CONFIG}"
TARGET="${EXPORTER_TARGET:-127.0.0.1:9110}"
JOB_NAME="grafana-anomaly-exporter"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Bu script root olarak calismalidir." >&2
  exit 1
fi

if [[ ! -f "$PROM_CONFIG" ]]; then
  echo "Prometheus config bulunamadi: $PROM_CONFIG" >&2
  exit 1
fi

if grep -q "job_name: $JOB_NAME" "$PROM_CONFIG"; then
  echo "Prometheus scrape job zaten mevcut: $JOB_NAME"
else
  cp "$PROM_CONFIG" "$PROM_CONFIG.bak.$(date +%Y%m%d%H%M%S)"
  if grep -Eq '^scrape_configs:\s*$' "$PROM_CONFIG"; then
    cat >> "$PROM_CONFIG" <<EOF

  - job_name: $JOB_NAME
    scrape_interval: 10s
    static_configs:
      - targets:
          - $TARGET
EOF
  else
    cat >> "$PROM_CONFIG" <<EOF

scrape_configs:
  - job_name: $JOB_NAME
    scrape_interval: 10s
    static_configs:
      - targets:
          - $TARGET
EOF
  fi
fi

if [[ "$PROM_CONFIG" != "$DEFAULT_PROM_CONFIG" ]]; then
  echo "Prometheus config override kullanildi. Live systemctl reload atlandi."
elif systemctl is-enabled prometheus >/dev/null 2>&1 || systemctl status prometheus >/dev/null 2>&1; then
  systemctl reload prometheus >/dev/null 2>&1 || systemctl restart prometheus
  echo "Prometheus reload edildi."
else
  echo "Prometheus servisi systemd altinda bulunamadi. Config guncellendi ama reload senin tarafindan yapilmali." >&2
fi

echo "Scrape job aktif: $JOB_NAME -> $TARGET"
