# Anomaly Detector Final Default Config

Bu dokuman benchmark sonucu iyi cikan ayarlardan hareketle hazirlanmistir.

Onemli not:

- Bu ayarlar runtime koda uygulanmistir.
- Seasonal algoritma da daha robust hale getirilmistir.
- Yine de gercek Elastic runtime export gelmeden tam vendor parity karari verilmemelidir.

## Mevcut kod tarafindaki preset yapisi

Mevcut preset tanimlari burada:

- [SimplePanel.tsx](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/alpas-anomalydetector-panel/src/components/SimplePanel.tsx)

Kod icindeki bugunku presetler ozetle:

| Preset | Algorithm | Sensitivity | Baseline window | Seasonal refinement | Severity |
| --- | --- | --- | --- | --- | --- |
| traffic | ewma | 2.1 | 14 | cycle | warning_first |
| latency | mad | 2.4 | 12 | cycle | page_first |
| error_rate | mad | 2.6 | 18 | cycle | page_first |
| resource | ewma | 2.3 | 18 | cycle | balanced |
| business | seasonal | 2.4 | 10 | weekday_hour | balanced |

## Benchmark tabanli uygulanan default set

| Preset | Onerilen algorithm | Onerilen sensitivity | Onerilen baseline window | Onerilen seasonal refinement | Onerilen severity | Not |
| --- | --- | --- | --- | --- | --- | --- |
| traffic | ewma | 4.5 | 30 | cycle | warning_first | False positive ciddi dusuyor |
| latency | mad | 4.0 | 12 | cycle | page_first | Spike senaryosunda temizlesiyor |
| error_rate | mad | 4.5 | 12 | cycle | page_first | Burst error davranisinda belirgin iyilesme |
| resource | ewma | 4.5 | 24 | cycle | balanced | Step-up anomalilerinde guclu sonuc |
| business | seasonal | simdilik degistirme | simdilik degistirme | simdilik degistirme | balanced | Seasonal model acigi oldugu icin otomatik guncelleme onerilmez |

## Uygulama durumu

Uygulanan degisiklikler:

1. `latency`, `error_rate`, `traffic`, `resource` presetleri benchmarkta iyi cikan ayarlara tasindi
2. `business` presetinde threshold / window / refinement daha guvenli hale getirildi
3. Seasonal tarafta `weekday_hour -> hour_of_day` fallback eklendi
4. Seasonal spread hesabi robust hale getirildi

Kod degisikliginin uygulandigi ana yer:

- [SimplePanel.tsx](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/alpas-anomalydetector-panel/src/components/SimplePanel.tsx)
- [algorithms.py](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/prometheus-live-demo/anomaly_exporter/app/algorithms.py)
- [models.py](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/prometheus-live-demo/anomaly_exporter/app/models.py)

Sonraki karar noktasi:

`Gercek Elastic export'u bu yeni kodla birebir karsilastir ve ancak ondan sonra final parity karari ver`
