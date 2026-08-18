# Changelog

## 1.4.0 (2026-08-16)

- Fixed Grafana datasource legend and display-name propagation across the anomaly chart, tooltip, inspector, incident feed, score feed, and exporter recompute flow.
- Added persistent, backward-compatible visibility controls for the panel's major operational sections.
- Replaced direct anomaly-threshold number entry with a keyboard-accessible slider and clear Sensitive, Balanced, and Strict guidance.
- Removed the redundant threshold visibility switch; threshold tuning now appears automatically in Advanced mode.
- Added a full-history warm-up guard to prevent range-boundary false positives in panel and exporter scoring paths.

## 1.3.0 (2026-06-10)

- Added canonical scorer parity with the exporter for plugin-computed score feed flows.
- Added target-aware score feed actions for Prometheus, Loki, InfluxDB, PostgreSQL, ClickHouse, and Elasticsearch outputs.
- Fixed the peak score stat to use the normalized 0-100 severity score.
- Improved `level_shift` sustained-shift handling by keeping an older stable baseline reference.

## 1.2.1 (2026-04-02)

- Fixed chart rendering in Grafana `viewPanel`, `editPanel`, and constrained dashboard layouts by sizing the SVG against the real card container instead of relying on panel height guesses.
- Added resize-aware regression coverage for `editPanel`, `viewPanel`, `d-solo`, narrow layouts, and redraw flows to prevent chart clipping and crushed line rendering from returning.
- Re-validated responsive score-feed scenarios on live Grafana `11.6.7` and `12.4.1` stacks.

## 1.2.0 (2026-03-28)

- Added a new `level_shift` detector and a dedicated `Subtle level shift / drift` preset for sustained baseline changes.
- Tuned the recommended presets to align with the benchmark findings for traffic, latency, error, resource, and business metrics.
- Added confidence and data-quality scoring to both the panel and Prometheus exporter so operators can judge whether a signal is strong enough for alerting.
- Reworked the panel UX with grouped incidents, a clearer anomaly inspector, confidence-aware markers, and more operator-friendly wording.
- Expanded annotation and alert export payloads with confidence and data-quality fields for easier downstream automation.

## 1.0.0

Initial release.
