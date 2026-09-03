# Grafana Anomaly Detector v1.5.0

This release makes anomaly decisions direction-aware and hardens the plugin-to-exporter score-feed contract for continuous alerting.

## Highlights

- Adds Elastic-style `high_mean`, `low_mean`, and `high_or_low` detection directions.
- Recommended mode selects direction from metric semantics; Advanced mode exposes an explicit user override.
- Applies direction, absolute/relative deviation floors, minimum activity, N-of-M persistence, and data-quality gating identically in TypeScript and Python.
- Adds root and configurable base-path API aliases, including `/anomalyalarm`.
- Standardizes JSON API responses and adds capability negotiation, request IDs, body limits, optional bearer auth, CORS allowlisting, and datasource host allowlisting.
- Makes dynamic rule state thread-safe, atomic, revision-aware, idempotent, and recoverable with a backup file.
- Prevents startup races from creating duplicate runtime rules; automatic sync uses the saved dashboard query for deterministic 24/7 recomputation.
- Adds interactive legend isolation/hide controls without truncating high-cardinality series lists.
- Adds alert lifecycle hysteresis with recovery threshold, consecutive recovery buckets, cooldown, and explicit decision states.
- Adds live/ready/dependency health endpoints, rule data-state metrics, runtime scope cleanup, explicit panel unregister, quotas, and API rate limiting.
- Fixes InfluxDB annotated CSV table parsing and narrow-panel status-card reflow.

## Operational behavior

- `high_mean`: only upward deviations can alert.
- `low_mean`: only downward deviations can alert.
- `high_or_low`: both directions can alert.
- A blocked direction retains diagnostic raw score but publishes normalized alert score `0`.
- Default recommended persistence is three passing buckets in the latest four buckets where applicable.
- Dashboard-closed recomputation remains exporter-owned and does not depend on an open browser.
- Non-Prometheus sinks can be alerted from directly; Prometheus is not required unless it is the selected source or target.

## Compatibility

- Grafana: `11.6.7+`
- Validated Grafana: `11.6.7`, `12.4.0`
- Exporter Python: `3.9+`
- API schema: `3`

Upgrade the exporter first, validate `/api/capabilities`, then install the plugin.

## Assets

- `grafana-anomaly-detector-plugin.zip`
- `grafana-anomaly-exporter-bundle-1.5.0.zip`
- `SHA256SUMS_v1.5.0.txt`
