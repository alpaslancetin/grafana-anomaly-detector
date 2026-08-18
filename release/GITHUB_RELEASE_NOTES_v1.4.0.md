# Grafana Anomaly Detector v1.4.0

This release aligns the Grafana plugin, the always-on exporter, multi-datasource score sinks, alert handoff, and portable installation flow.

## Highlights

- Preserves Grafana datasource legends and aliases across the chart, incident inspector, score feed, exported records, and dashboard-closed exporter recomputation.
- Adds user-friendly threshold tuning from `0.2` to `10.0` with Sensitive, Balanced, and Strict guidance.
- Prevents range-boundary false positives with matching panel/exporter warm-up semantics.
- Keeps panel and exporter canonical scoring in parity, including NaN filtering, flatline/gappy data quality, and sustained level-shift behavior.
- Preserves the requested exporter evaluation cadence by subtracting evaluation time from the next-cycle sleep.
- Rejects non-finite or non-positive thresholds in file and dynamic rule configuration.
- Scopes demo source and alert queries to canonical rules so score records cannot recursively feed themselves.
- Improves panel accessibility with semantic headings and live status output.

## Portable exporter package fix

The bundle now opens ready for configuration and startup:

- adds `exporter/config.yml` as a working Prometheus-source starter configuration
- adds `exporter/examples/config.prometheus.yml`
- adds `exporter/examples/config.influxdb.yml` for InfluxDB 2.x source and sink
- adds `./portable-exporter.sh validate`
- fixes `./portable-exporter.sh restart`
- allows `ANOMALY_CONFIG_PATH` to select a custom configuration
- verifies Python `3.9+` before startup
- ships an empty dynamic-rule state instead of development dashboard records

The InfluxDB example uses different source and anomaly-score buckets to avoid feedback loops.

## Validation summary

- Python exporter tests: `23` passed, plus `14` subtests; distribution templates and feedback-loop safety are covered.
- Frontend unit tests: `23` passed.
- Playwright: `17` passed, `1` conditional scenario skipped.
- Canonical parity: `1,440` points, zero panel/exporter difference.
- Live evaluation cadence: `5.009s` average, `5.077s` maximum for a configured `5s` cycle.
- Live multi-sink flow: Prometheus, Loki, InfluxDB, PostgreSQL, ClickHouse, and Elasticsearch verified with dashboard open and closed.

## Compatibility

- Grafana: `11.6.7+`
- Validated Grafana: `11.6.7`, `12.4.0`
- Exporter Python: `3.9+`

## Assets

- `grafana-anomaly-detector-plugin.zip`
- `grafana-anomaly-exporter-bundle-1.4.0.zip`
- `SHA256SUMS_v1.4.0.txt`
