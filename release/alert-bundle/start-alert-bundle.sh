#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROM_URL="${1:-http://127.0.0.1:9090}"
ENV_FILE="$SCRIPT_DIR/.env"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker bulunamadi." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"
fi

python3 - "$ENV_FILE" "$PROM_URL" <<'PY'
import pathlib
import sys

env_path = pathlib.Path(sys.argv[1])
prom_url = sys.argv[2]
lines = env_path.read_text(encoding='utf-8').splitlines()
updated = False
for index, line in enumerate(lines):
    if line.startswith('ANOMALY_SOURCE_PROMETHEUS_URL='):
        lines[index] = f'ANOMALY_SOURCE_PROMETHEUS_URL={prom_url}'
        updated = True
if not updated:
    lines.append(f'ANOMALY_SOURCE_PROMETHEUS_URL={prom_url}')
env_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
PY

cd "$SCRIPT_DIR"
docker compose up -d --build

echo "Docker bundle hazir."
echo "Exporter: http://127.0.0.1:9110"
echo "Score Prometheus: http://127.0.0.1:9092"
