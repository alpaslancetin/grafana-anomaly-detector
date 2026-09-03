# Grafana Anomaly Detector

Plugin version: **1.5.0**. Plugin ID: `alpas-anomalydetector-panel`.

Analyze numeric time-series with z-score, rolling MAD, EWMA, seasonal, or level-shift detection. Inspect expected bands, severity, confidence, data quality, and incident details.

## Install

1. Download the plugin ZIP from the [v1.5.0 release](https://github.com/alpaslancetin/grafana-anomaly-detector/releases/tag/v1.5.0).
2. Extract its contents into `<grafana-plugins>/alpas-anomalydetector-panel/`.
3. This build is unsigned. Add `allow_loading_unsigned_plugins = alpas-anomalydetector-panel` under `[plugins]` in the active Grafana configuration.
4. Restart Grafana, refresh the browser, and choose Anomaly Detector as the panel visualization.

Grafana 11.6.7 or later is required. Runtime checks were performed on 11.6.7 and 12.4.0.

## Configure

Use Recommended mode for metric-aware defaults, or Advanced mode to choose the algorithm, detection direction, threshold, floors, persistence, and recovery behavior. Visible sections controls layout only. Focus band and export blocks are optional.

## Continuous score feed

The optional exporter is version 1.5.0 and requires Python 3.9 or later. Choose one target, save the dashboard, and sync the query/settings to the exporter. Registered sources can then be recomputed without keeping the panel open. The exporter needs source credentials, network access, and durable state.

Targets are Prometheus metrics, Loki, InfluxDB, PostgreSQL, ClickHouse, and Elasticsearch. Prometheus is not required for a non-Prometheus source/target flow. Copy the target-specific query into Grafana Alerting and configure routing and No Data/Error behavior; opening the builder does not save a rule automatically.

## Documentation and limitations

- [Current installation and upgrade guide](https://github.com/alpaslancetin/grafana-anomaly-detector/blob/main/release/GRAFANA_ANOMALY_DETECTOR_E2E_KURULUM_UPGRADE_KILAVUZU_v1.5.0_TR.md)
- [Verified release scope and remaining work](https://github.com/alpaslancetin/grafana-anomaly-detector/blob/main/release/STATUS_v1.5.0.md)

The chart uses custom SVG. Native Time Series multi-axis, zoom/pan and shared-cursor parity is not complete.
