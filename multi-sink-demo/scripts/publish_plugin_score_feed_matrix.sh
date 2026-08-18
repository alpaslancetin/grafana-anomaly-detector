#!/usr/bin/env bash
set -euo pipefail

EXPORTER_URL="${EXPORTER_URL:-http://127.0.0.1:9110}"
SOURCES=(prometheus loki influxdb postgresql clickhouse elasticsearch)
TARGETS=(prometheus loki influxdb postgresql clickhouse elasticsearch)

source_type() {
  case "$1" in
    prometheus) echo "prometheus" ;;
    loki) echo "loki" ;;
    influxdb) echo "influxdb" ;;
    postgresql) echo "postgres" ;;
    clickhouse) echo "grafana-clickhouse-datasource" ;;
    elasticsearch) echo "elasticsearch" ;;
    *) echo "$1" ;;
  esac
}

source_uid() {
  case "$1" in
    prometheus) echo "demo-prometheus" ;;
    loki) echo "demo-loki" ;;
    influxdb) echo "demo-influxdb" ;;
    postgresql) echo "demo-postgresql" ;;
    clickhouse) echo "demo-clickhouse" ;;
    elasticsearch) echo "demo-elasticsearch" ;;
    *) echo "demo-$1" ;;
  esac
}

target_score() {
  local source_index="$1"
  local target_index="$2"
  echo $((91 + ((source_index + target_index) % 8)))
}

post_score_feed() {
  local source_name="$1"
  local target_name="$2"
  local source_index="$3"
  local target_index="$4"
  local now
  local score
  local rule
  local panel_id
  local payload

  now="$(date +%s)"
  score="$(target_score "$source_index" "$target_index")"
  rule="matrix_${source_name}_to_${target_name}"
  panel_id=$((source_index * 10 + target_index + 1))

  payload="$(cat <<JSON
{
  "target": "${target_name}",
  "dashboardUid": "plugin-source-matrix",
  "dashboardTitle": "Plugin Source Matrix",
  "panelId": ${panel_id},
  "panelTitle": "Plugin ${source_name} source to ${target_name}",
  "ruleName": "${rule}",
  "source": "local-matrix-test",
  "sourceDatasources": [
    {
      "uid": "$(source_uid "$source_name")",
      "type": "$(source_type "$source_name")"
    }
  ],
  "resolvedOptions": {
    "algorithm": "mad",
    "severityPreset": "page_first",
    "sensitivity": 4.0
  },
  "series": [
    {
      "key": "${source_name}-series",
      "label": "${source_name} score sample",
      "timestamp": ${now},
      "value": ${score},
      "expected": 50,
      "lower": 40,
      "upper": 70,
      "deviation": $((score - 50)),
      "rawScore": 3.4,
      "pointRawScore": 3.4,
      "windowRawScore": 1.2,
      "scoreDriver": "point",
      "normalizedScore": ${score},
      "severityLabel": "critical",
      "isAnomaly": true,
      "confidenceScore": 92,
      "confidenceLabel": "high",
      "dataQualityLabel": "healthy"
    }
  ],
  "rule": {
    "timestamp": ${now},
    "score": ${score},
    "rawScore": 3.4,
    "breachCount": 1,
    "seriesCount": 1,
    "activeSeries": 1,
    "severityLabel": "critical"
  }
}
JSON
)"

  response="$(curl -fsS -H "Content-Type: application/json" --data "$payload" "${EXPORTER_URL%/}/api/feed/scores")"
  if ! grep -q '"acceptedSeries": 1' <<<"$response"; then
    echo "[FAIL] ${rule} was not accepted by exporter" >&2
    echo "$response" >&2
    return 1
  fi
  echo "[OK] published ${rule}"
}

wait_for_exporter() {
  for _ in $(seq 1 60); do
    if curl -fsS "${EXPORTER_URL%/}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "[FAIL] exporter is not reachable at ${EXPORTER_URL}" >&2
  return 1
}

wait_for_exporter

for source_index in "${!SOURCES[@]}"; do
  for target_index in "${!TARGETS[@]}"; do
    post_score_feed "${SOURCES[$source_index]}" "${TARGETS[$target_index]}" "$source_index" "$target_index"
  done
done

echo "[OK] plugin-computed source/target matrix published"
