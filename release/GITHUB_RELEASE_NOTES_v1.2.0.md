# Grafana Anomaly Detector v1.2.0

Grafana Anomaly Detector `v1.2.0` is a benchmark-backed release that brings the panel, exporter, documentation, and delivery assets to a more production-ready state.

This version focuses on three areas:

- stronger anomaly quality through benchmark-driven tuning
- more operator-friendly panel experience
- cleaner rollout material for production and evaluation teams

## Highlights

### Detection and scoring

- Added a dedicated `level_shift` detector for sustained baseline changes
- Added the `Subtle level shift / drift` preset for gradual or persistent shifts
- Tuned recommended presets for traffic, latency, error, resource, and business metrics
- Added confidence and data-quality scoring to the panel and exporter
- Exposed `grafana_anomaly_confidence_score` for downstream alerting and triage

### Panel and chart UX

- Improved anomaly readability with stronger markers and more explicit severity mapping
- Added inline series labels for faster chart reading
- Added focus band, hover crosshair, and pinned tooltip behavior
- Reworked the anomaly inspector with clearer operational language
- Improved multi-metric incident reading and grouped event presentation

### Alerting and score feed

- Improved Prometheus score-feed behavior and export visibility
- Added clearer rule sync outputs and operational export blocks
- Expanded alert export payloads with confidence and data-quality fields
- Refined bundle compatibility for portable exporter usage, including Python 3.9 compatible packaging

### Documentation and deliverables

- Refreshed the end-to-end Turkish tutorial with up-to-date screenshots and workflow explanations
- Added benchmark reports, Elastic side-by-side comparison material, and presentation decks
- Added rollout and production upgrade runbooks for release consumers

## Included assets

- Plugin-only package: `release/grafana-anomaly-detector-plugin.zip`
- Alert bundle: `release/grafana-anomaly-detector-alert-bundle.zip`
- Python 3.9 compatible alert bundle: `release/grafana-anomaly-detector-alert-bundle-python39.zip`
- End-to-end tutorial:
  - `tutorial/Anomaly_Detector_End_to_End_TR.html`
  - `tutorial/Anomaly_Detector_End_to_End_TR.pdf`
- Benchmark package:
  - `benchmarks/Final_Benchmark_Raporu_TR.md`
  - `benchmarks/elastic_side_by_side/`
  - `benchmarks/presentation/output/`

## Validation snapshot

- Minimum supported Grafana: `11.6.7`
- Live compatibility verified on: `11.6.7`, `12.4.1`
- Plugin version: `1.2.0`
- Tested flows include:
  - panel build and typecheck
  - responsive dashboard, `viewPanel`, `d-solo`, and resize-redraw chart rendering
  - chart and inspector UX updates
  - score-feed export path
  - benchmark dataset comparisons
  - updated tutorial generation

## Upgrade notes

- Keep `allow_loading_unsigned_plugins = alpas-anomalydetector-panel`
- If score feed is in use, upgrade the exporter bundle together with the panel
- After upgrade, perform a hard refresh in the browser
- Validate the presence of:
  - `Subtle level shift / drift`
  - `Confidence`
  - `Data quality`
  - `Main reason`
  - `grafana_anomaly_confidence_score`

## Recommended release attachments

- `grafana-anomaly-detector-plugin.zip`
- `grafana-anomaly-detector-alert-bundle.zip`
- `grafana-anomaly-detector-alert-bundle-python39.zip`
- `Anomaly_Detector_End_to_End_TR.pdf`
- benchmark presentation deck from `benchmarks/presentation/output/`
