# Grafana Anomaly Detector v1.2.1

## What changed

This release focuses on chart rendering stability in real Grafana panel flows.

- fixed crushed or clipped chart rendering in `viewPanel`
- fixed layout issues when the panel is opened with `editPanel`
- fixed constrained dashboard and redraw cases where the SVG could outgrow the visible chart card
- added responsive regression coverage for `viewPanel`, `editPanel`, `d-solo`, narrow layouts, and resize/redraw flows

## Compatibility

- minimum supported Grafana version: `11.6.7`
- live validated versions:
  - `11.6.7`
  - `12.4.1`

## Included packages

- `grafana-anomaly-detector-plugin.zip`
- `grafana-anomaly-exporter-bundle-1.2.1.zip`

## Operational note

The plugin ID remains `alpas-anomalydetector-panel` for upgrade compatibility with existing Grafana installations.
The exporter bundle requires `Python 3.9+` and is recommended to run on `Python 3.9.x`.
