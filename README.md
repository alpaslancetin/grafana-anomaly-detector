# Grafana Anomaly Detector

A Grafana panel plugin for anomaly detection on time-series data, with an optional Prometheus score-feed exporter for operational alerting.

This repository contains the panel source code, the live Prometheus demo stack, and the release packages needed to install or evaluate the detector in Grafana environments.

## Minimum supported Grafana version

This release line requires **Grafana `11.6.7` or later**.

The plugin manifest declares:

- `grafanaDependency: >=11.6.7`

## Current release

- Plugin version: `1.2.0`
- Plugin ID: `alpas-anomalydetector-panel`
- Minimum supported Grafana target: `11.6.7`
- Validated Grafana targets: `11.6.7`, `12.4.1`

The plugin ID remains `alpas-anomalydetector-panel` for release compatibility with existing installations. Public repository paths and package names use neutral project naming.

## What it does

- Detects anomalies on time-series data inside a Grafana panel
- Supports guided `Recommended` mode and expert `Advanced` mode
- Includes `zscore`, `mad`, `ewma`, `seasonal`, and `level_shift` detection models
- Exposes anomaly context such as expected value, deviation, confidence, data quality, and main reason
- Optionally publishes alertable Prometheus metrics through the score-feed exporter

## Screenshots

### Single metric panel

![Grafana Anomaly Detector single metric panel](assets/readme/grafana-single-metric-premium.png)

### Multi-metric incident view

![Grafana Anomaly Detector multi metric view](assets/readme/grafana-multi-metric-premium.png)

### Score feed and export block

![Grafana Anomaly Detector score feed export block](assets/readme/score-feed-export.png)

## Repository layout

| Path | Purpose |
| --- | --- |
| `grafana-anomaly-detector-panel/` | Plugin source code |
| `prometheus-live-demo/` | Local demo stack with Prometheus and exporter flow |
| `release/` | Release packages and GitHub release notes |
| `assets/readme/` | README screenshots used on GitHub |

## Requirements

### Runtime requirements

- Grafana: `>= 11.6.7`
- Prometheus: required only if you want score-feed based alerting

### Development requirements

- Node.js `22+`
- npm `10+`

## Grafana compatibility

The current `v1.2.0` release is packaged and supported for:

- `Grafana >= 11.6.7`
- Validated with live responsive and score-feed tests on `11.6.7` and `12.4.1`

This dependency is declared in:

- `grafana-anomaly-detector-panel/src/plugin.json`
- `grafana-anomaly-detector-panel/dist/plugin.json`

## Quick start

### Plugin development

```bash
cd grafana-anomaly-detector-panel
npm install
npm run dev
```

Useful commands:

```bash
npm run build
npm run typecheck
npm run test:ci
npm run e2e
```

### Live demo

```bash
cd prometheus-live-demo
docker compose up --build
```

Typical local endpoints:

- Grafana: `http://localhost:3000`
- Prometheus: `http://localhost:9091`
- Exporter metrics: `http://localhost:9110/metrics`

## Score feed exporter

The score feed exporter turns panel-side anomaly settings into Prometheus metrics that can be used in Grafana Alerting or any Prometheus-compatible alerting workflow.

Exporter source code lives in:

- `prometheus-live-demo/anomaly_exporter/`

Core flow:

1. Build or open an anomaly panel in Grafana
2. Set `Score feed mode` to `Auto` or `Manual`
3. Point the panel to an exporter endpoint such as `http://127.0.0.1:9110`
4. The panel syncs rule metadata to the exporter
5. The exporter evaluates the PromQL source on a rolling basis and exposes Prometheus metrics

Main exported metrics:

- `grafana_anomaly_rule_score`
- `grafana_anomaly_score`
- `grafana_anomaly_confidence_score`

Important behavior:

- The score feed is a live rolling detector, not a replay of the dashboard time range
- Exported scores are based on the synced rule configuration, PromQL lookback, and exporter history
- Removing a dashboard does not automatically delete synced exporter rules unless they are cleaned from exporter state

## Release packages

Main outputs under `release/`:

- `grafana-anomaly-detector-plugin.zip`
- `grafana-anomaly-detector-alert-bundle.zip`
- `grafana-anomaly-detector-alert-bundle-python39.zip`

The release folder is kept focused on packaged artifacts. Source code for the exporter remains under `prometheus-live-demo/anomaly_exporter/`.

## Alerting flow

1. Build an anomaly panel in Grafana
2. Sync the score feed if exporter mode is enabled
3. Query `grafana_anomaly_rule_score{rule="..."}` from Prometheus
4. Use that metric in Grafana Alerting

## License

This project is licensed under Apache-2.0. See [LICENSE](LICENSE).
