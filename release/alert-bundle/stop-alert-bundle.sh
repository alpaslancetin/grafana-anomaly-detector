#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker bulunamadi." >&2
  exit 1
fi

cd "$SCRIPT_DIR"
docker compose down

echo "Docker bundle durduruldu."
