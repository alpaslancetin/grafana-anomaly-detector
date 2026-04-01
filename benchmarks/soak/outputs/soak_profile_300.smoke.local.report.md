# Soak Test Report

- Target dynamic detectors: 300
- Duration seconds: 75
- Samples collected: 4
- Final verdict: pass

## Sample summary

| Sample | Eval duration (s) | Scrape success | Dashboard failures | Render failures | Effective breach count | Warmup ignored |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.710078 | 1.0 | 0 | 0 | 0 | True |
| 2 | 0.902318 | 1.0 | 0 | 0 | 0 | False |
| 3 | 0.774309 | 1.0 | 0 | 0 | 0 | False |
| 4 | 0.728129 | 1.0 | 0 | 0 | 0 | False |

## Notes

- This package is intended for 350-400 detector soak runs with alert-path queries, dashboard page checks, and render checks enabled together.
- If dashboard or render checks return 302 or 401, provide valid Grafana auth headers in the config file.
