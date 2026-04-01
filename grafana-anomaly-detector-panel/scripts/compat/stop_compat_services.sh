#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PANEL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT_DIR="$(cd "$PANEL_DIR/.." && pwd)"
RUNTIME_ROOT="${GRAFANA_COMPAT_RUNTIME_ROOT:-/root/grafana-compat}"

find "$RUNTIME_ROOT" -type f -name '*.pid' | while read -r pid_file; do
  if [[ -s "$pid_file" ]]; then
    kill "$(cat "$pid_file")" 2>/dev/null || true
  fi
  rm -f "$pid_file"
done

echo "compat services stopped"
