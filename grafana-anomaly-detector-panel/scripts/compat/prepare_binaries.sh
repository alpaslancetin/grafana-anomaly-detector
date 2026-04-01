#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PANEL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT_DIR="$(cd "$PANEL_DIR/.." && pwd)"
COMPAT_DIR="$ROOT_DIR/.compat"
mkdir -p "$COMPAT_DIR"
cd "$COMPAT_DIR"

download_grafana() {
  local version="$1"
  local archive="grafana-$version.tar.gz"
  local dest="grafana-$version"
  if [[ -d "$dest" ]]; then
    return
  fi
  curl -L "https://dl.grafana.com/oss/release/grafana-${version}.linux-amd64.tar.gz" -o "$archive"
  tar -xzf "$archive"
  if [[ -d "$dest" ]]; then
    return
  fi
  local extracted
  extracted="$(find . -maxdepth 1 -type d \( -name "grafana-v${version}*" -o -name "grafana-${version}*" \) | head -n1)"
  if [[ -z "$extracted" ]]; then
    echo "Could not locate extracted Grafana directory for version $version" >&2
    exit 1
  fi
  mv "$extracted" "$dest"
}

download_prometheus() {
  local version="$1"
  local archive="prometheus-$version.tar.gz"
  local dest="prometheus-$version"
  if [[ -d "$dest" ]]; then
    return
  fi
  curl -L "https://github.com/prometheus/prometheus/releases/download/v${version}/prometheus-${version}.linux-amd64.tar.gz" -o "$archive"
  tar -xzf "$archive"
  mv "prometheus-${version}.linux-amd64" "$dest"
}

download_grafana "11.0.0"
download_grafana "11.6.7"
download_grafana "11.6.13"
download_grafana "12.4.1"
download_prometheus "2.53.4"

echo "prepared"
