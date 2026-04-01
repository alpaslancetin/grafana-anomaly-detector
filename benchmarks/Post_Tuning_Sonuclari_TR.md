# Anomaly Detector - Post Tuning Sonuclari

Tarih: 2026-03-27

## Ozet

Bu turda uc sey birlikte yapildi:

1. Runtime default presetler benchmark sonucuna gore guncellendi
2. Seasonal detection mantigi daha robust hale getirildi
3. Elastic ile 1:1 veri seti uzerinden gorsel ve sayisal karsilastirma hattı hazirlandi

## Kodda ne degisti?

Ana degisiklik noktalarimiz:

- [SimplePanel.tsx](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/alpas-anomalydetector-panel/src/components/SimplePanel.tsx)
- [algorithms.py](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/prometheus-live-demo/anomaly_exporter/app/algorithms.py)
- [models.py](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/prometheus-live-demo/anomaly_exporter/app/models.py)

Yapilan teknik tuning:

- `traffic` preset: `ewma / 4.5 / 30`
- `latency` preset: `mad / 4.0 / 12`
- `error_rate` preset: `mad / 4.5 / 12`
- `resource` preset: `ewma / 4.5 / 24`
- `business` preset: `seasonal / 4.5 / 8 / cycle`
- Seasonal tarafta robust MAD tabanli spread
- Seasonal tarafta trend farkindaligi
- `weekday_hour` icin `hour_of_day` fallback
- `MIN_SEASONAL_SAMPLES = 3`

## Benchmark sonucu

Guncel functional benchmark:

- [functional_benchmark_summary.json](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/functional/outputs/functional_benchmark_summary.json)
- [functional_benchmark_report.md](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/functional/outputs/functional_benchmark_report.md)

Guncel sonuc:

| Metrik | Sonuc |
| --- | --- |
| Ortalama precision | 1.0 |
| Ortalama recall | 1.0 |
| Ortalama F1 | 1.0 |
| Ortalama false positive rate | 0.0 |
| Enterprise hedef profiline uyan senaryo | 5 / 5 |

Bu sonuc, kendi labeled benchmark setimiz icinde yeni default kodun artik hedef profili tamamen karsiladigini gosteriyor.

## Tuning sweep sonucu

- [functional_tuning_sweep_summary.json](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/functional/outputs/functional_tuning_sweep_summary.json)

Yorum:

- Yeni defaultlar ile tuning sweep arasinda fark neredeyse kalmadi
- Bu da runtime default secimimizin benchmark bazli olarak iyi oturdugunu gosteriyor

## Elastic side-by-side hazirligi

Hazirlanan akis:

- [elastic side-by-side README](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/elastic_side_by_side/README_TR.md)
- [scenario manifest](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/elastic_side_by_side/outputs/labeled_scenarios/scenario_manifest.json)
- [all scenarios ndjson](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/elastic_side_by_side/outputs/labeled_scenarios/all_scenarios.ndjson)
- [visual report](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/elastic_side_by_side/outputs/visual_report/side_by_side_visual_report.html)
- [side by side metrics](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/elastic_side_by_side/outputs/scored_comparisons/side_by_side_metrics.md)

Bugunku durum:

- Bizim detector icin 1:1 gorseller hazir
- Elastic import pipeline hazir
- Gercek Elastic records export henuz yuklenmedi

Bu nedenle:

`Gercek Elastic vendor-to-vendor skor tablosu icin sadece Elastic records export eksik`

## Soak paketi sonucu

Hazir paket:

- [soak README](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/soak/README_TR.md)
- [350 profile](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/soak/soak_profile_350.example.json)
- [400 profile](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/soak/soak_profile_400.example.json)

Kisa smoke dogrulamalari:

- [350 soak report](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/soak/outputs/soak_profile_350.example.report.md)
- [400 soak report](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/soak/outputs/soak_profile_400.example.report.md)

Sonuc:

- `350 detector` kisa smoke: pass
- `400 detector` kisa smoke: pass

Not:

- Soak runner'a warm-up grace eklendi
- Ilk sample'daki ramp-up spike'lari yalanci risk yaratmasin diye ilk ornek ignore edilebiliyor
- Dashboard ve render check'leri auth gerektiren ortamlarda header/basic auth ile aktif edilebiliyor

## Build / kalite kapisi

Panel typecheck ve build basarili:

- `npm run typecheck` -> basarili
- `npm run build` -> basarili

## Su anki net teknik karar

Bugunku kod tabani icin:

1. Kendi labeled benchmark setimizde anomaly detector artik enterprise-hedef profile tam uyuyor
2. 350-400 detector soak paketi hazir ve kisa smoke dogrulandi
3. Gercek Elastic side-by-side vendor sonucu icin tek eksik parca Elastic records export

## Siradaki en net adim

1. Elastic job'larini ayni NDJSON dataset ile kos
2. Records export'u normalize et
3. Visual report ve metrics report'u gercek Elastic verisiyle tekrar uret
4. Sonra `biz mi daha iyiyiz, Elastic mi daha iyi` kararini sayisal olarak ver
