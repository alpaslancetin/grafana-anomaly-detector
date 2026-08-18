#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXPORTER_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

cd "$EXPORTER_DIR"
python3 -m unittest discover -s tests -v
