# Grafana Anomaly Detector Panel

Source code for the custom Grafana panel plugin used in the Grafana Anomaly Detector project.

This package is the UI and scoring layer of the project. It detects anomalies directly on time-series panels, visualizes expected behavior, and exposes export helpers that make the result operationally usable.

The public source folder uses a neutral repository name, while the plugin ID remains `alpas-anomalydetector-panel` for compatibility with installed environments.

## What is inside

- React and TypeScript based Grafana panel implementation
- Recommended and Advanced configuration flows
- Multiple anomaly scoring algorithms
- Expected line and band visualization
- Click-to-inspect anomaly detail workflow
- Demo dashboards provisioned for TestData and Prometheus-backed scenarios

## Main folders

| Path | Purpose |
| --- | --- |
| `src/` | Panel source code |
| `provisioning/` | Demo dashboards and datasource provisioning |
| `tests/` | End-to-end tests |
| `.config/` | Build and tooling configuration |

## Development

Requirements:

- Node.js 22+
- npm 10+
- Grafana 11.6.7+

Validated compatibility:

- Grafana 11.6.7
- Grafana 12.4.1

The minimum supported version declared by the plugin manifest is `>=11.6.7`.

Commands:

```bash
npm install
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test:ci
npm run e2e
```

## Provisioned dashboards

The repository includes ready-made dashboards for:

- TestData based manual anomaly exploration
- Prometheus-backed live anomaly scoring

Relevant files:

- `provisioning/dashboards/dashboard.json`
- `provisioning/dashboards/prometheus-live-dashboard.json`

## Score feed context

This panel can sync anomaly rule metadata to the exporter used in the live demo stack. The exporter source lives under:

- `../prometheus-live-demo/anomaly_exporter/`

That exporter exposes Prometheus metrics such as:

- `grafana_anomaly_rule_score`
- `grafana_anomaly_score`
- `grafana_anomaly_confidence_score`

## Related documentation

- [Project root README](../README.md)

## License

Apache-2.0
