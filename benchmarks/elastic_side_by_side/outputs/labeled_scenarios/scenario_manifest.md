# Elastic Labeled Scenario Manifest

| Scenario | Step | Points | Labeled anomalies | Suggested detector function | Suggested bucket span |
| --- | --- | --- | --- | --- | --- |
| latency_spike_mad | 300s | 96 | 4 | high_mean | 5m |
| error_burst_mad | 300s | 96 | 5 | high_mean | 5m |
| traffic_drop_ewma | 300s | 96 | 7 | low_mean | 5m |
| seasonal_hourly_spike | 3600s | 192 | 2 | high_mean | 1h |
| resource_step_ewma | 300s | 120 | 8 | high_mean | 5m |
| subtle_level_shift | 300s | 120 | 12 | high_mean | 5m |
