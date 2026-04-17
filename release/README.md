# Release Packages

This folder contains the packaged outputs for `Grafana Anomaly Detector v1.2.1`.

## Minimum supported Grafana version

This release line requires **Grafana `11.6.7` or later**.

## Files

- `grafana-anomaly-detector-plugin.zip`
  - plugin-only distribution
- `grafana-anomaly-exporter-bundle-1.2.1.zip`
  - exporter-only score feed bundle for alerting flows
- `GITHUB_RELEASE_NOTES_v1.2.1.md`
  - release body text for GitHub releases

## Compatibility

- Supported Grafana target for this release: `>= 11.6.7`
- Live compatibility verified on: `11.6.7`, `12.4.1`
- Minimum supported exporter Python version: `3.9`
- Recommended exporter Python version: `3.9.x`

## Notes

- The release folder keeps only the current `v1.2.1` artifacts
- The Grafana plugin ID remains `alpas-anomalydetector-panel` inside the built plugin for compatibility with existing installations
- Exporter source code lives in `prometheus-live-demo/anomaly_exporter/` at the repository root
