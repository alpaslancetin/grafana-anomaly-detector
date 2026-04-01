# Functional Tuning Sweep Report

This report estimates the best reachable quality with the current detector algorithm set and per-scenario tuning.
Enterprise target profile: precision>=0.8, recall>=0.75, F1>=0.77, FP rate<=0.2, delay<=3 points.

## Overall

- Scenario count: 6
- Default pass count: 6 / 6
- Tuned pass count: 6 / 6
- Mean precision: 1.0 -> 1.0
- Mean recall: 1.0 -> 1.0
- Mean F1: 1.0 -> 1.0
- Mean false positive rate: 0.0 -> 0.0

## Scenario comparison

| Scenario | Default P | Tuned P | Default F1 | Tuned F1 | Default FP | Tuned FP | Tuned pass | Best config |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| latency_spike_mad | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 0.0 | True | mad, th=4.0, win=12 |
| error_burst_mad | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 0.0 | True | mad, th=4.5, win=12 |
| traffic_drop_ewma | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 0.0 | True | ewma, th=4.5, win=30 |
| seasonal_hourly_spike | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 0.0 | True | seasonal, th=2.4, win=5, ref=hour_of_day |
| resource_step_ewma | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 0.0 | True | ewma, th=4.5, win=24 |
| subtle_level_shift | 1.0 | 1.0 | 1.0 | 1.0 | 0.0 | 0.0 | True | level_shift, th=3.0, win=24 |

## Interpretation

- If tuned pass count remains low, the current algorithm family still falls short of enterprise parity even after parameter tuning.
- If tuned pass count increases strongly, the gap is primarily calibration, not architecture.
- Seasonal scenario behavior is the strongest signal for whether deeper model capability is needed.
