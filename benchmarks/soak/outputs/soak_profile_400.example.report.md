# Soak Test Report

- Target dynamic detectors: 400
- Duration seconds: 75
- Samples collected: 5
- Final verdict: pass

## Sample summary

| Sample | Eval duration (s) | Scrape success | Dashboard failures | Render failures | Effective breach count | Warmup ignored |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1.326382 | 1.0 | 0 | 0 | 0 | True |
| 2 | 0.950109 | 1.0 | 0 | 0 | 0 | False |
| 3 | 1.013048 | 1.0 | 0 | 0 | 0 | False |
| 4 | 1.210363 | 1.0 | 0 | 0 | 0 | False |
| 5 | 0.953165 | 1.0 | 0 | 0 | 0 | False |

## Notes

- This package is intended for 350-400 detector soak runs with alert-path queries, dashboard page checks, and render checks enabled together.
- If dashboard or render checks return 302 or 401, provide valid Grafana auth headers in the config file.
