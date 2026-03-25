# alpas-anomalydetector-panel

Source code for the custom Grafana panel plugin used in the Grafana Anomaly Detector Lab.

This package is the UI and scoring layer of the project. It detects anomalies directly on time-series panels, visualizes expected behavior, and exposes export helpers that make the result operationally usable.

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
- Grafana 12.4.x

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

## Related documentation

- [Project root README](../README.md)
- [Detailed Turkish tutorial](../tutorial/Anomaly_Detector_End_to_End_TR.html)
- [Turkish usage summary](../KULLANIM_OZETI_TR.md)
- [Turkish alerting guide](../ALERTING_TR.md)

## License

Apache-2.0
