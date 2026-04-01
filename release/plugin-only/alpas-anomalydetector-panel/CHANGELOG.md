# Changelog

## 1.2.0 (2026-03-28)

- Added a new `level_shift` detector and a dedicated `Subtle level shift / drift` preset for sustained baseline changes.
- Tuned the recommended presets to align with the benchmark findings for traffic, latency, error, resource, and business metrics.
- Added confidence and data-quality scoring to both the panel and Prometheus exporter so operators can judge whether a signal is strong enough for alerting.
- Reworked the panel UX with grouped incidents, a clearer anomaly inspector, confidence-aware markers, and more operator-friendly wording.
- Expanded annotation and alert export payloads with confidence and data-quality fields for easier downstream automation.

## 1.0.0

Initial release.
