#!/usr/bin/env bash
set -euo pipefail

PLUGIN_ID="alpas-anomalydetector-panel"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$SCRIPT_DIR/$PLUGIN_ID"
GRAFANA_PLUGIN_ROOT="${GRAFANA_PLUGIN_ROOT:-/var/lib/grafana/plugins}"
TARGET_DIR="$GRAFANA_PLUGIN_ROOT/$PLUGIN_ID"
GRAFANA_INI="${GRAFANA_INI:-/etc/grafana/grafana.ini}"

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Bu script root olarak calismalidir. Ornek: sudo ./install-rhel-plugin.sh" >&2
  exit 1
fi

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Plugin klasoru bulunamadi: $SOURCE_DIR" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 gerekli ama bulunamadi." >&2
  exit 1
fi

mkdir -p "$GRAFANA_PLUGIN_ROOT"
rm -rf "$TARGET_DIR"
cp -R "$SOURCE_DIR" "$TARGET_DIR"

if id grafana >/dev/null 2>&1; then
  chown -R grafana:grafana "$TARGET_DIR"
fi

if [[ -f "$GRAFANA_INI" ]]; then
  cp "$GRAFANA_INI" "$GRAFANA_INI.bak.$(date +%Y%m%d%H%M%S)"
  python3 - "$GRAFANA_INI" "$PLUGIN_ID" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
plugin_id = sys.argv[2]
text = path.read_text(encoding='utf-8')
if not text.endswith('\n'):
    text += '\n'

line_pattern = re.compile(r'(?m)^(\s*allow_loading_unsigned_plugins\s*=\s*)(.*)$')
section_pattern = re.compile(r'(?m)^\[plugins\]\s*$')

match = line_pattern.search(text)
if match:
    current = [item.strip() for item in match.group(2).split(',') if item.strip()]
    if plugin_id not in current:
        current.append(plugin_id)
    replacement = f"{match.group(1)}{', '.join(current)}"
    text = line_pattern.sub(replacement, text, count=1)
elif section_pattern.search(text):
    text = section_pattern.sub(f"[plugins]\nallow_loading_unsigned_plugins = {plugin_id}", text, count=1)
else:
    text += f"\n[plugins]\nallow_loading_unsigned_plugins = {plugin_id}\n"

path.write_text(text, encoding='utf-8')
PY
else
  echo "Uyari: $GRAFANA_INI bulunamadi. allow_loading_unsigned_plugins ayarini elle eklemelisin." >&2
fi

if command -v restorecon >/dev/null 2>&1; then
  restorecon -R "$GRAFANA_PLUGIN_ROOT" >/dev/null 2>&1 || true
fi

systemctl restart grafana-server

echo "Plugin kuruldu: $TARGET_DIR"
echo "Grafana servisi yeniden baslatildi."
echo "Sonraki adim: Grafana'da yeni panel acip visualization olarak Anomaly Detector sec."
