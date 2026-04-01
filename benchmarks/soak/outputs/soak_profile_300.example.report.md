# Soak Test Report

- Target dynamic detectors: 300
- Duration seconds: 75
- Samples collected: 5
- Final verdict: pass

## Sample summary

| Sample | Eval duration (s) | Scrape success | Dashboard failures | Render failures | Effective breach count | Warmup ignored |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.728884 | 1.0 | 0 | 0 | 0 | True |
| 2 | 0.752495 | 1.0 | 0 | 0 | 0 | False |
| 3 | 0.763424 | 1.0 | 0 | 0 | 0 | False |
| 4 | 0.804875 | 1.0 | 0 | 0 | 0 | False |
| 5 | 0.772264 | 1.0 | 0 | 0 | 0 | False |

## Notes

- This package is intended for 350-400 detector soak runs with alert-path queries, dashboard page checks, and render checks enabled together.
- If dashboard or render checks return 302 or 401, provide valid Grafana auth headers in the config file.
