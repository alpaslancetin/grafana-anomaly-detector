# Grafana Anomaly Detector

A Grafana panel plugin for anomaly detection on time-series data, with an optional Prometheus score-feed exporter for operational alerting.

This repository is intentionally kept simple. It contains the plugin source, the live Prometheus demo, and the release packages needed to install or evaluate the detector.

## Minimum supported Grafana version

This release line requires **Grafana `12.4.0` or later**.

The plugin manifest declares:

- `grafanaDependency: >=12.4.0`

## Current release

- Plugin version: `1.2.0`
- Plugin ID: `alpas-anomalydetector-panel`
- Validated Grafana target: `12.4.1`

## What it does

- Detects anomalies on time-series data inside a Grafana panel
- Supports guided `Recommended` mode and expert `Advanced` mode
- Includes `zscore`, `mad`, `ewma`, `seasonal`, and `level_shift` detection models
- Exposes anomaly context such as expected value, deviation, confidence, data quality, and main reason
- Optionally publishes alertable Prometheus metrics through the score-feed exporter

## Repository layout

| Path | Purpose |
| --- | --- |
| `alpas-anomalydetector-panel/` | Plugin source code |
| `prometheus-live-demo/` | Local demo stack with Prometheus and exporter flow |
| `release/` | Release packages and GitHub release notes |

## Requirements

### Runtime requirements

- Grafana: `>= 12.4.0`
- Prometheus: required only if you want score-feed based alerting

### Development requirements

- Node.js `22+`
- npm `10+`

## Grafana compatibility

The current `v1.2.0` release is packaged and supported for:

- `Grafana >= 12.4.0`

This dependency is declared in:

- `alpas-anomalydetector-panel/src/plugin.json`
- `alpas-anomalydetector-panel/dist/plugin.json`

## Quick start

### Plugin development

```bash
cd alpas-anomalydetector-panel
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

## Release packages

Main outputs under `release/`:

- `alpas-anomalydetector-panel-plugin-only.zip`
- `alpas-anomaly-alert-bundle.zip`
- `alpas-anomaly-alert-bundle-python39-compatible.zip`

## Alerting flow

1. Build an anomaly panel in Grafana
2. Sync the score feed if exporter mode is enabled
3. Query `grafana_anomaly_rule_score{rule="..."}` from Prometheus
4. Use that metric in Grafana Alerting

## License

This project is licensed under Apache-2.0. See [LICENSE](LICENSE).
