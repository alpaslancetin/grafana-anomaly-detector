# Grafana Anomaly Detector v1.3.0

## What changed

This release adds plugin-computed anomaly score feed publishing and optional multi-datasource sink support to the exporter.

- added canonical scoring parity between the Grafana panel and exporter range scorer
- added `scripts/parity_check.py` with a fixed proof case: `2026-04-10 12:00 UTC panel_score=10 fed_score=10`
- added range source readers for Prometheus, Loki, InfluxDB, PostgreSQL, ClickHouse, and Elasticsearch
- preserved the legacy Prometheus instant-query path when range/source fields are not configured
- added `/api/feed/scores` for score snapshots calculated inside Grafana panels
- added panel option `Score feed target` so users can publish scores to Prometheus metrics or one selected sink
- added support for source/target split flows, such as PostgreSQL panel data producing anomaly scores that are written to Elasticsearch
- added Loki feed sink
- added InfluxDB feed sink
- added PostgreSQL feed sink with optional `psycopg` driver fallback
- added ClickHouse feed sink
- added Elasticsearch feed sink
- added `grafana_anomaly_sink_*` health metrics
- added sink queue/backpressure metrics: `grafana_anomaly_sink_queue_depth`, `grafana_anomaly_sink_queue_capacity`, `grafana_anomaly_sink_dropped_batches_total`, and `grafana_anomaly_sink_last_drop_timestamp_seconds`
- added `grafana_anomaly_build_info{version="1.3.0"}`
- added Loki `unwrap normalized_score` query_range matrix validation
- added `multi-sink-demo/` with pinned images, read-back checks, canonical parity validation, and datasource-specific example alert rules
- added target-aware alert query generation for plugin-computed feeds: PromQL, LogQL, Flux, SQL, and Elasticsearch query specs now match the selected score feed target
- improved panel incident detail fallback and dense-list layout so timeline clicks keep annotation/detail actions visible on all demo datasource panels
- added `scripts/verify_multi_sink_panel_buttons.mjs` to validate incident actions, score feed buttons, synced rule queries, and alert export output across the six demo datasource flows
- reduced Loki stream cardinality by keeping dynamic fields such as `severity_label` and `is_anomaly` in the JSON payload instead of stream labels
- scoped Loki unwrap dashboard and alert queries to avoid `maximum of series (500) reached` on normal dashboard ranges
- tightened default anomaly thresholds to reduce out-of-box false positives while preserving demo incident coverage
- fixed the panel `PEAK SCORE` stat to display the normalized 0-100 severity score instead of an unbounded raw detector score
- fixed PostgreSQL sink recovery after backend restart by invalidating stale cached connections on write errors
- fixed silent sink queue drops for plugin-computed feed targets by returning HTTP `429` when non-Prometheus sink writes cannot be queued
- increased default sink queue capacity to handle normal multi-sink publish bursts
- hardened canonical scoring against NaN/Inf input points
- improved `level_shift` scoring so sustained shifts keep an older stable reference baseline instead of quickly becoming the new normal
- optimized `level_shift` reference-window scoring after retest so throughput is back above the 10k points/sec benchmark target
- fixed anomaly panel legend score formatting so series legends use the normalized 0-100 severity score (`max 100`) instead of raw score values such as `100.000.000`

## Retest summary

- R3 retest result: all blocking acceptance failures are closed.
- Golden parity remained stable after the final `level_shift` and legend fixes: 1080 points compared, `2026-04-10 12:00 UTC panel_score=10 fed_score=10`.
- Multi-sink stability was validated across Loki, InfluxDB, PostgreSQL, ClickHouse, and Elasticsearch; PostgreSQL reconnect no longer requires exporter restart.
- `level_shift` is intentionally positioned for sustained-change rules. It is more persistent and zero-delay for level shifts, but may need a higher threshold or dedicated rule usage when low false-positive background is more important than immediate sustained-change detection.

## Compatibility

- minimum supported Grafana version: `11.6.7`
- live validated versions:
  - `11.6.7`
  - `12.4.0`
- minimum supported exporter Python version: `3.9`
- recommended exporter Python version: `3.9.x`

## Included packages

- `grafana-anomaly-detector-plugin.zip`
- `grafana-anomaly-exporter-bundle-1.3.0.zip`

## Operational note

Existing Prometheus metrics, `/metrics`, `/health`, `/api/sync/panel`, and `/api/sync/rules` remain available. If `sinks:` is not configured, plugin-computed scores are still exposed from the exporter Prometheus metrics endpoint.

When a panel writes scores to a non-Prometheus target, the panel no longer presents a PromQL-only alert query. The exported/synced query follows the target store: Loki returns LogQL, InfluxDB returns Flux, PostgreSQL and ClickHouse return SQL, and Elasticsearch returns an Elasticsearch query spec.

For non-Prometheus feed targets, sink queue pressure is explicit. If the exporter cannot queue a sink write, `/api/feed/scores` returns HTTP `429` and the queue/drop metrics show the condition. Prometheus-metrics target mode remains local to `/metrics` and does not use the sink queue.
