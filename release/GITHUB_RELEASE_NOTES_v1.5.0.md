# Grafana Anomaly Detector v1.5.0-r1

Current package revision: **v1.5.0-r1**. Plugin/exporter application version remains **1.5.0**, API schema **3**. This release makes anomaly decisions direction-aware and hardens the plugin-to-exporter score-feed contract for continuous alerting.

## Post-release fixes included in r1

- Unknown-direction fallback is consistent in panel/exporter; the panel exposes a configuration warning.
- Invalid DELETE panel IDs receive structured JSON 400; browser-visible request/version headers aid proxy diagnostics.
- Compact charts attach resize observation after data arrives, fit their containers and separate time labels from the axis caption.
- Corrected point-F1 and explicitly separated strict detection quality from historical regression checks.
- Versioned plugin/exporter ZIP names, build manifests, ready-to-edit Prometheus/Influx YAML samples, and [same-origin LB guidance](https://github.com/alpaslancetin/grafana-anomaly-detector/blob/main/docs/ANOMALYALARM_PROXY_TR.md).

Strict synthetic detection quality still has open findings, especially hard seasonal cases; this is not unconditional production acceptance. See [retest details](https://github.com/alpaslancetin/grafana-anomaly-detector/blob/main/docs/V1_5_0_RETEST_FIX_REVIEW_TR.md).

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

## Scope and limitations

The plugin is unsigned. This release retains the custom SVG chart; native Grafana Time Series multi-axis, zoom/pan, shared cursor, and the full small-panel/visibility visual matrix are not complete. Real labeled field-data backtesting, long soak/load qualification, signing, and production canary execution remain required before organization-specific production acceptance.

See the [current scope report](https://github.com/alpaslancetin/grafana-anomaly-detector/blob/main/release/STATUS_v1.5.0.md) and [installation guide](https://github.com/alpaslancetin/grafana-anomaly-detector/blob/main/release/GRAFANA_ANOMALY_DETECTOR_E2E_KURULUM_UPGRADE_KILAVUZU_v1.5.0_TR.md). Historical PDFs and screenshots are references, not a v1.5.0 visual acceptance baseline.

The original v1.5.0 tag and ZIPs retain their original checksums. This separate v1.5.0-r1 release contains the reviewed fixes; use its new checksums and build manifests. The application version remains 1.5.0 by request; the package revision distinguishes the builds.

## Assets

- `grafana-anomaly-detector-plugin-1.5.0-r1.zip`
- `grafana-anomaly-exporter-bundle-1.5.0-r1.zip`
- `SHA256SUMS_v1.5.0-r1.txt`
- `GRAFANA_ANOMALY_DETECTOR_E2E_KURULUM_UPGRADE_KILAVUZU_v1.5.0_TR.md`
- `PACKAGE_CONTENTS_v1.5.0_TR.md`
- `STATUS_v1.5.0.md`
- `RELEASE_1_5_0_R1_VERIFICATION.md` (test results and explicit quality/performance limitations)

Validation: plugin 35/35, exporter 44/44 on Python 3.12 and 3.9.25, 3,801 parity points,
browser suite 19 passed/1 skipped on Grafana 12.4.0. The strict detection gate remains
failed; this session also missed the historical 10k points/s throughput floor.
See the [verification record](https://github.com/alpaslancetin/grafana-anomaly-detector/blob/main/docs/RELEASE_1_5_0_R1_VERIFICATION.md). Do not interpret this maintenance release as unconditional production acceptance.
