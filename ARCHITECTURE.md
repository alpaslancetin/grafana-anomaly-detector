# Grafana Anomaly Detector Architecture

## End-to-end flow

1. A Grafana panel reads a numeric time series from a datasource.
2. The panel prepares the same canonical point stream: sort, dedupe, optional bucket aggregation, then trailing-window scoring.
3. The panel uses the canonical TypeScript scorer and renders the anomaly score, expected value, bands, confidence, and data quality.
4. The exporter can read the same source range and uses the matching Python canonical scorer.
5. The exporter writes the canonical `0-100` score to Prometheus metrics and to any configured sink.
6. Grafana Alerting can then query Prometheus or a sink datasource.

## Canonical score

The alert/feed score is the panel-visible `severityScore`, named `normalized_score` in exporter records and exposed as `grafana_anomaly_score` / `grafana_anomaly_rule_score`.

Raw algorithm distance is still preserved as `raw_score` / `grafana_anomaly_score_raw`. Alert thresholds such as `> 95` should use the canonical `0-100` score.

## Parity guarantee

Parity is guaranteed by using the same scoring spec and the same input semantics on both sides:

- Same sorted timestamp/value stream.
- Same duplicate timestamp averaging.
- Same optional bucket aggregation.
- Same trailing baseline window: the current point is scored against only previous points.
- Same algorithms: `zscore`, `mad`, `ewma`, `seasonal`, and `level_shift`.
- Same severity normalization, confidence, and data quality states.

The parity script runs the TypeScript panel scorer and Python exporter scorer against the same fixture and compares every point with `epsilon=1e-6`. The fixed example proves the intended behavior:

```text
2026-04-10 12:00 UTC panel_score=10 fed_score=10
```

## Warm-up and cold-start

During cold-start, both sides return score `0`, confidence `low`, and data quality `thin` until enough baseline history exists. Parity becomes meaningful after the minimum baseline window is populated. The demo uses a warm range so visible panels and feed records are past this point.

## Source readers

The exporter keeps the legacy Prometheus instant path when no range metadata is configured. For parity mode, rules can set `range_seconds`, `step_seconds`, and `bucket_span_seconds`.

Supported source types:

- `prometheus`
- `loki`
- `influxdb`
- `postgresql`
- `clickhouse`
- `elasticsearch`

HTTP-based readers use Python stdlib. PostgreSQL uses optional `psycopg` or `psycopg2`; if the driver is missing, only that source is reported unhealthy and the exporter keeps running.

## Sink writers

The exporter writes already-computed snapshots. Sink writers never recalculate anomaly scores.

Supported sinks:

- Loki
- InfluxDB
- PostgreSQL
- ClickHouse
- Elasticsearch

Prometheus metrics remain the default path. If `sinks:` is omitted, existing `grafana_anomaly_*` behavior is preserved.

Sink health is visible through:

- `grafana_anomaly_sink_up`
- `grafana_anomaly_sink_last_write_timestamp_seconds`
- `grafana_anomaly_sink_write_duration_seconds`
- `grafana_anomaly_sink_records_written_total`
- `grafana_anomaly_sink_errors_total`
- `grafana_anomaly_sink_last_error`

## Loki time-series

Loki stores logs, so dashboards and alerts must use range aggregation plus `unwrap` to get a numeric matrix:

```logql
max_over_time({job="grafana_anomaly_exporter",record_type="series"} | json normalized_score="normalized_score" | unwrap normalized_score [1m])
```

The demo read-back check calls Loki `query_range` and asserts `resultType: matrix`.

## Deploy modes

Supported operating modes:

- Docker Compose demo: `multi-sink-demo/docker-compose.yml`
- Portable exporter bundle: `portable-exporter.sh`
- RHEL install scripts in the release bundle
- Podman-compatible flow, using the same ports and environment variables

Minimum Python for the exporter is `3.9`. Grafana plugin compatibility is `>=11.6.7`, validated on `11.6.7` and `12.4.0`.
