# Prometheus Live Demo

This folder contains the Prometheus-backed demo environment used to operationalize anomaly scores produced by the Grafana Anomaly Detector panel.

It is intended for local validation, live demonstrations, and end-to-end testing of the score feed workflow that turns panel-side anomaly analysis into Prometheus metrics consumable by Grafana Alerting.

## Components

| Path | Purpose |
| --- | --- |
| `anomaly_exporter/` | Exporter that publishes anomaly score metrics |
| `synthetic_exporter/` | Synthetic metric producer for demo traffic and latency signals |
| `prometheus/` | Prometheus configuration used by the demo stack |
| `docker-compose.yml` | Local orchestration entry point |
| `grafana-prometheus-datasource.yml` | Datasource provisioning snippet |

## Metrics used in the demo

Input metrics:

- `demo_latency_ms`
- `demo_requests_per_second`
- `demo_error_rate_percent`

Operational anomaly metrics:

- `grafana_anomaly_score`
- `grafana_anomaly_rule_score`

## Run locally

```bash
cd prometheus-live-demo
docker compose up --build
```

Typical local endpoints:

- Prometheus: `http://localhost:9091`
- Exporter metrics: `http://localhost:9110/metrics`

## When to use this folder

Use this demo stack when you want to:

- validate score-feed behavior end to end
- test alert rules against exporter-generated metrics
- demonstrate the Prometheus-backed anomaly workflow
- reproduce the tutorial environment

## Related documentation

- [Project root README](../README.md)
- [Turkish alerting guide](../ALERTING_TR.md)
- [Detailed Turkish tutorial](../tutorial/Anomaly_Detector_End_to_End_TR.html)
