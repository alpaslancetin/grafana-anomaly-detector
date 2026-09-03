# Changelog

## 1.5.0

- Added user-configurable Elastic-style `high_mean`, `low_mean`, and `high_or_low` anomaly direction policies with identical panel and exporter behavior.
- Added minimum absolute/relative deviation, minimum activity, N-of-M persistence, and degraded-data decision gates.
- Added root and configurable base-path API aliases, structured JSON errors, capabilities negotiation, bounded request bodies, CORS allowlists, optional bearer authentication, and datasource host allowlists.
- Made dynamic rule registration thread-safe, idempotent, scope-aware, revision-aware, and crash-safe with atomic state writes and backup recovery.
- Added dynamic state health and registration counters to the Prometheus exporter metrics.
- Added interactive series isolate/hide controls, complete scrollable legends/tooltips, and responsive chart-only layout behavior.
- Added recovery-threshold hysteresis, consecutive recovery buckets, cooldown, and explicit candidate/open/recovering lifecycle states with TypeScript/Python parity.
- Added separate live, ready, and dependency health endpoints plus per-rule anomaly, decision-state, data-state, and last-sample metrics.
- Added dynamic-rule quotas, runtime-scope TTL, feed-preview TTL, explicit panel deletion, request rate limiting, same-origin redirect enforcement, and valid Prometheus label normalization.
- Fixed multi-table InfluxDB annotated CSV parsing so changing tag schemas cannot corrupt source labels or create cardinality noise.
- Fixed narrow dashboard panels to reflow status metadata and KPI cards based on panel width rather than browser viewport width.

## 1.4.0

- Preserved Grafana legends and aliases from datasource frames through panel views, exported score records, and dashboard-closed exporter recomputation.
- Added per-panel visibility controls for major Anomaly Detector sections with legacy defaults and automatic grid reflow.
- Added a `0.2` to `10.0` anomaly-threshold slider with semantic Sensitive, Balanced, and Strict guidance.
- Removed the redundant threshold visibility switch and made threshold tuning automatically available in Advanced mode.
- Added matching panel/exporter warm-up behavior so range-boundary points cannot alert before the configured history window is complete.
- Added a reproducible detection quality gate covering event recall, false-positive rate, warm-up behavior, and scorer throughput.

## 1.3.0

- Added optional multi-datasource anomaly feed sinks for Loki, InfluxDB, PostgreSQL, ClickHouse, and Elasticsearch.
- Kept the existing Prometheus exposition and score-feed sync flow intact; `sinks:` is fully optional.
- Added sink health metrics under `grafana_anomaly_sink_*`.
- Added sink queue/backpressure metrics and HTTP `429` feedback when non-Prometheus feed targets cannot queue writes.
- Added an exporter build info metric with the `1.3.0` version label.
- Added a WSL-friendly `multi-sink-demo/` stack with pinned backend images, read-back checks, and datasource-specific example alert rules.
- Added exporter unit/smoke tests for config fallback parsing, Loki runtime integration, HTTP sink payloads, and PostgreSQL optional-driver fallback.
- Fixed PostgreSQL sink reconnection after backend restarts by invalidating stale connections after write errors.
- Hardened canonical scoring against NaN/Inf input points and improved `level_shift` sustained-shift handling.
- Optimized `level_shift` after retest so benchmark throughput is again above 10k points/sec.
- Fixed anomaly panel legend `max` values to display normalized 0-100 severity scores.

## 1.2.1

- Stabilized Grafana panel rendering in `viewPanel`, `editPanel`, `d-solo`, narrow layouts, and resize/redraw flows.
