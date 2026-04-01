# Kod ve Teslim Notlari

Bu not, son benchmark turunda urune giren teknik iyilestirmeleri, tekrar gecilen test zincirini ve teslim paketine alinmasi gereken guncel artefact'lari ozetler.

## Koda giren ana iyilestirmeler

### 1. Benchmark tabanli runtime kalibrasyonu

Panel ve exporter tarafinda benchmark sonucuna gore guncel runtime default'lari uygulandi:

- `traffic`: `ewma / 4.5 / 30`
- `latency`: `mad / 4.0 / 12`
- `error_rate`: `mad / 4.5 / 12`
- `resource`: `ewma / 4.5 / 24`
- `business`: `seasonal / 4.5 / 8 / cycle`
- `level_shift`: dedicated sustained shift profili

### 2. Seasonal baseline sertlestirmesi

Seasonal anomaly detection tarafinda:

- robust MAD spread mantigi kullanildi
- `weekday_hour` sparse kaldiginda `hour_of_day` fallback eklendi
- minimum seasonal sample esigi korundu
- trend farkindaligi guclendirildi

### 3. Level-shift ve shift-aware auto recommendation

Benchmark sonucu onerilen ana backlog kalemleri urune girdi:

- `subtle_level_shift` odakli yeni preset
- `level_shift` detector
- auto recommendation icinde shift / drift pattern tespiti

### 4. Premium chart ve operator UX zenginlestirmesi

Panel tarafinda su iyilestirmeler aktif:

- incident timeline
- anomaly inspector
- active detection profile
- confidence ve data quality anlatimi
- inline series labels
- focus band
- severity'ye gore marker sekilleri
- range-aware time axis
- hover crosshair
- pinned tooltip
- incident grouping ribbon
- keyboard incident navigation

### 5. Exporter sinyal metrikleri

Exporter artik yalnizca skor degil, karar kalitesini de tasiyor:

- `grafana_anomaly_confidence_score`
- `score_driver`
- `confidence_label`
- `data_quality_label`

### 6. Test harness ve soak runner duzeltmesi

Soak runner'da PNG render cevabinin metin gibi decode edilmesi nedeniyle yalanci `render failure` ureten hata giderildi. Bu duzeltme sonrasi `300 / 350 / 400` kisa soak kosulari tekrar alindi ve dogrulandi.

### 7. Lokal test stack iyilestirmeleri

Lokal smoke ve E2E icin:

- lokal Prometheus datasource provisioning eklendi
- docker compose stack'e image renderer baglandi
- Grafana test stack `http://localhost:3300` uzerinden ayaga kaldirildi
- benchmark screenshot capture akisi eklendi

## Degisen ana kaynak dosyalar

Bu turda dogrudan degisen ana kaynaklar:

- `alpas-anomalydetector-panel/src/components/SimplePanel.tsx`
- `alpas-anomalydetector-panel/src/module.ts`
- `alpas-anomalydetector-panel/src/types.ts`
- `alpas-anomalydetector-panel/tests/panel.spec.ts`
- `alpas-anomalydetector-panel/tests/capture_benchmark_screenshots.mjs`
- `alpas-anomalydetector-panel/provisioning/datasources/prometheus-live.yml`
- `alpas-anomalydetector-panel/.config/docker-compose-base.yaml`
- `alpas-anomalydetector-panel/docker-compose.yaml`
- `prometheus-live-demo/anomaly_exporter/app/algorithms.py`
- `prometheus-live-demo/anomaly_exporter/app/models.py`
- `prometheus-live-demo/anomaly_exporter/app/server.py`
- `benchmarks/functional/run_functional_benchmark.py`
- `benchmarks/functional/run_functional_tuning_sweep.py`
- `benchmarks/elastic_side_by_side/export_labeled_scenarios_for_elastic.py`
- `benchmarks/elastic_side_by_side/run_local_elastic_benchmark.py`
- `benchmarks/elastic_side_by_side/build_side_by_side_visual_report.py`
- `benchmarks/soak/run_soak_package.py`

## Son fonksiyonel karar

- Final runtime: labeled benchmark suite uzerinde `6/6` pass
- Final runtime mean precision / recall / F1: `1.0 / 1.0 / 1.0`
- Elastic trial side-by-side: ayni dataset uzerinde bizim final detector daha basarili

## Son kapasite karari

- Tek snapshot dogrulama: `400` detector `1.020447s`
- Kisa smoke: `300`, `350`, `400` `pass`
- `400` detector smoke icinde gorulen maksimum eval suresi: `1.326382s`
- Uzun sureli prod ceiling karari icin `8 saat+` soak halen gerekli

## Bu turda yeniden gecilen test zinciri

- `python3 benchmarks/functional/run_functional_benchmark.py`
- `python3 benchmarks/functional/run_functional_tuning_sweep.py`
- `python3 benchmarks/elastic_side_by_side/run_local_elastic_benchmark.py`
- `python3 benchmarks/performance/run_detector_scale_extended.py`
- `python3 benchmarks/soak/run_soak_package.py --config ...300...`
- `python3 benchmarks/soak/run_soak_package.py --config ...350...`
- `python3 benchmarks/soak/run_soak_package.py --config ...400...`
- `node tests/capture_benchmark_screenshots.mjs`
- `npm run typecheck`
- `npm run test:ci`
- `npm run build`
- `npm run e2e`

## Lokal ayakta kalan test ortami

Su an lokal test icin kullanilabilecek servisler:

- Grafana: `http://localhost:3300`
- Prometheus: `http://localhost:9091`
- Exporter metrics: `http://localhost:9110/metrics`
- Renderer health: `http://localhost:8081/healthz`
- Elastic: `http://localhost:9200`

## Teslim paketine tasinmasi gereken guncel artefact'lar

- son benchmark raporlari
- gercek Elastic side-by-side export'lari
- gorsel HTML benchmark raporu
- guncel screenshot seti
- kisa soak raporlari
- re-run runbook
- guncel panel build'i ile yenilenmis plugin paketi
- benchmark sunumu `.pptx` ve kaynak `.js`

## Sonraki onerilen teknik aksiyonlar

1. `350-400 detector` seviyesi icin uzun soak al.
2. Multi-entity / population / rare-event benchmark senaryolari ekle.
3. Benchmark screenshot setini yeni use case'lerle genislet.
4. Desktop teslim klasorunu guncel benchmark ciktilari ve guncel plugin paketi ile senkronize et.
