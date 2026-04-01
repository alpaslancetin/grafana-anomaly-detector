# Detector Scale Extended Report

This test increases synced dynamic detector count until the exporter-side evaluation time or scrape health becomes risky.
Safety guardrail in this run: evaluation duration <= 1.5 seconds and scrape success = 1.

## Stages

| Target dynamic rules | Config rule count | Eval duration (s) | Scrape success | Rule series | Series score series | Exporter metrics latency (s) | Prom query latency (s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 75 | 78.0 | 0.189857 | 1.0 | 78.0 | 108.0 | 0.0036 | 0.0095 |
| 100 | 103.0 | 0.243183 | 1.0 | 103.0 | 142.0 | 0.0039 | 0.0037 |
| 150 | 153.0 | 0.382123 | 1.0 | 153.0 | 208.0 | 0.0044 | 0.0042 |
| 200 | 203.0 | 0.527709 | 1.0 | 203.0 | 274.0 | 0.007 | 0.0035 |
| 300 | 303.0 | 0.913882 | 1.0 | 303.0 | 408.0 | 0.0098 | 0.0051 |
| 400 | 403.0 | 1.020447 | 1.0 | 403.0 | 542.0 | 0.0124 | 0.0043 |

## Result

- Estimated safe dynamic detector limit in this environment: 400
- Stop reason: completed planned stages

## Notes

- This is still not a full browser render stress test.
- It is, however, a much stronger detector-side capacity estimate than the initial smoke run.
