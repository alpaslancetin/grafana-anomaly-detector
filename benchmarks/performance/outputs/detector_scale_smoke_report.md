# Detector Scale Smoke Report

This is an initial exporter-side and Prometheus-side smoke load test.
It does not yet represent a full browser-side Grafana dashboard rendering limit.

## Stages

| Target dynamic rules | Config rule count | Eval duration (s) | Rule score series | Series score series | Last scrape success |
| --- | --- | --- | --- | --- | --- |
| 3 | 6.0 | 0.016383 | 6.0 | 12.0 | 1.0 |
| 10 | 13.0 | 0.039647 | 13.0 | 26.0 | 1.0 |
| 25 | 28.0 | 0.092116 | 28.0 | 56.0 | 1.0 |
| 50 | 53.0 | 0.191868 | 53.0 | 106.0 | 1.0 |

## Notes

- Dynamic rule count represents detectors synced from Grafana panels.
- Config rule count includes static and dynamic rules together.
- If evaluation duration remains near-linear while scrape success stays at 1, the detector side is still healthy in this stage range.
