# Soak Test Report

- Target dynamic detectors: 400
- Duration seconds: 75
- Samples collected: 4
- Final verdict: pass

## Sample summary

| Sample | Eval duration (s) | Scrape success | Dashboard failures | Render failures | Effective breach count | Warmup ignored |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1.001199 | 1.0 | 0 | 0 | 0 | True |
| 2 | 1.021421 | 1.0 | 0 | 0 | 0 | False |
| 3 | 1.072784 | 1.0 | 0 | 0 | 0 | False |
| 4 | 1.208941 | 1.0 | 0 | 0 | 0 | False |

## Notes

- This package is intended for 350-400 detector soak runs with alert-path queries, dashboard page checks, and render checks enabled together.
- If dashboard or render checks return 302 or 401, provide valid Grafana auth headers in the config file.
