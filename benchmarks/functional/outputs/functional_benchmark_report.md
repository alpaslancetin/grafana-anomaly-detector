# Functional Benchmark Report

Reference mode: Elastic-aligned enterprise target profile (not a direct Elastic runtime export).

## Overall summary

- Scenario count: 6
- Passed target profile: 6 / 6
- Mean precision: 1.0
- Mean recall: 1.0
- Mean F1: 1.0
- Mean false positive rate: 0.0

## Scenario results

| Scenario | Algorithm | Precision | Recall | F1 | FP rate | Delay (points) | Target pass |
| --- | --- | --- | --- | --- | --- | --- | --- |
| latency_spike_mad | mad | 1.0 | 1.0 | 1.0 | 0.0 | 0 | True |
| error_burst_mad | mad | 1.0 | 1.0 | 1.0 | 0.0 | 0 | True |
| traffic_drop_ewma | ewma | 1.0 | 1.0 | 1.0 | 0.0 | 0 | True |
| seasonal_hourly_spike | seasonal | 1.0 | 1.0 | 1.0 | 0.0 | 0 | True |
| resource_step_ewma | ewma | 1.0 | 1.0 | 1.0 | 0.0 | 0 | True |
| subtle_level_shift | level_shift | 1.0 | 1.0 | 1.0 | 0.0 | 0 | True |

## Notes

- This benchmark measures our current detector quality against a target profile inspired by enterprise anomaly detection expectations.
- It does not yet compare against a real Elastic ML result export.
- The next parity step should be to feed the same labeled scenarios to Elastic and import the result file into the same reporting flow.
