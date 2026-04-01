# Side-by-Side Metric Comparison

- Elastic results loaded: True
- Elastic standard threshold: 25.0
- Elastic best threshold: 1.0

## Overall

- Default mean precision: 1.0
- Tuned mean precision: 1.0
- Elastic standard mean precision: 0.3333
- Elastic best mean precision: 0.8043
- Default mean F1: 1.0
- Tuned mean F1: 1.0
- Elastic standard mean F1: 0.1367
- Elastic best mean F1: 0.7067

## Scenario matrix

| Scenario | Default P | Tuned P | Elastic Std P | Elastic Best P | Default F1 | Tuned F1 | Elastic Std F1 | Elastic Best F1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| latency_spike_mad | 1.0 | 1.0 | 0.0 | 0.6667 | 1.0 | 1.0 | 0.0 | 0.5714 |
| error_burst_mad | 1.0 | 1.0 | 0.0 | 0.75 | 1.0 | 1.0 | 0.0 | 0.6667 |
| traffic_drop_ewma | 1.0 | 1.0 | 0.0 | 0.8333 | 1.0 | 1.0 | 0.0 | 0.7692 |
| seasonal_hourly_spike | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.6667 | 1.0 |
| resource_step_ewma | 1.0 | 1.0 | 0.0 | 0.6667 | 1.0 | 1.0 | 0.0 | 0.3636 |
| subtle_level_shift | 1.0 | 1.0 | 1.0 | 0.9091 | 1.0 | 1.0 | 0.1538 | 0.8696 |

## Elastic threshold sweep

| Threshold | Mean precision | Mean recall | Mean F1 | Mean FP rate |
| --- | --- | --- | --- | --- |
| 1.0 | 0.8043 | 0.6496 | 0.7067 | 0.0086 |
| 2.0 | 0.7389 | 0.4675 | 0.5557 | 0.0086 |
| 3.0 | 0.6667 | 0.3782 | 0.4566 | 0.0086 |
| 5.0 | 0.6389 | 0.3448 | 0.4209 | 0.0086 |
| 7.5 | 0.5833 | 0.3002 | 0.364 | 0.0086 |
| 10.0 | 0.5833 | 0.3002 | 0.364 | 0.0086 |
| 15.0 | 0.5833 | 0.3002 | 0.364 | 0.0086 |
| 20.0 | 0.3333 | 0.2014 | 0.2238 | 0.0086 |
| 50.0 | 0.3333 | 0.0972 | 0.1367 | 0.0015 |
| 25.0 | 0.3333 | 0.0972 | 0.1367 | 0.007 |
| 30.0 | 0.3333 | 0.0972 | 0.1367 | 0.007 |
| 40.0 | 0.3333 | 0.0972 | 0.1367 | 0.007 |
| 60.0 | 0.1667 | 0.0833 | 0.1111 | 0.0 |
| 75.0 | 0.0 | 0.0 | 0.0 | 0.0 |
