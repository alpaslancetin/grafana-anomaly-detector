# Release Packages

This folder contains the packaged outputs for `Grafana Anomaly Detector v1.2.0`.

## Minimum supported Grafana version

This release line requires **Grafana `12.4.0` or later**.

## Files

- `grafana-anomaly-detector-plugin.zip`
  - plugin-only distribution
- `grafana-anomaly-detector-alert-bundle.zip`
  - plugin + exporter oriented alert bundle
- `grafana-anomaly-detector-alert-bundle-python39.zip`
  - alert bundle prepared for Python `3.9` compatible environments
- `GITHUB_RELEASE_NOTES_v1.2.0.md`
  - release body text for GitHub releases

## Compatibility

- Supported Grafana target for this release: `>= 12.4.0`

## Notes

- The package names are repository-facing release names
- The Grafana plugin ID remains `alpas-anomalydetector-panel` inside the built plugin for compatibility with existing installations
- Exporter source code lives in `prometheus-live-demo/anomaly_exporter/` at the repository root
