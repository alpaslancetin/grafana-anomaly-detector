# Release Packages

This folder contains the packaged outputs for `Grafana Anomaly Detector v1.3.0`.

## Minimum supported Grafana version

This release line requires **Grafana `11.6.7` or later**.

## Files

- `grafana-anomaly-detector-plugin.zip`
  - plugin-only distribution
- `grafana-anomaly-exporter-bundle-1.3.0.zip`
  - exporter score-feed bundle with multi-datasource source readers and feed sinks
- `GITHUB_RELEASE_NOTES_v1.3.0.md`
  - release body text for GitHub releases

## What is new in v1.3.0

- multi-datasource range readers: Prometheus, Loki, InfluxDB, PostgreSQL, ClickHouse, Elasticsearch
- plugin-computed score feed published to Prometheus metrics **or** one selected sink
- source/target split flows (for example PostgreSQL panel data scored into Elasticsearch)
- target-aware alert query generation: PromQL, LogQL, Flux, SQL, and Elasticsearch query specs
- sink health and queue/backpressure metrics, plus `grafana_anomaly_build_info{version="1.3.0"}`
- panel visual fixes (normalized `0-100` `PEAK SCORE` and legend) and detector tuning from the benchmark/retest cycle

## Compatibility

- Supported Grafana target for this release: `>= 11.6.7`
- Live compatibility verified on: `11.6.7`, `12.4.0`
- Minimum supported exporter Python version: `3.9`
- Recommended exporter Python version: `3.9.x`

## Notes

- The release folder keeps only the current `v1.3.0` artifacts
- The Grafana plugin ID remains `alpas-anomalydetector-panel` inside the built plugin for compatibility with existing installations
- Exporter source code lives in `prometheus-live-demo/anomaly_exporter/` at the repository root
- If `sinks` are not configured, plugin-computed scores are still exposed from the exporter Prometheus metrics endpoint
