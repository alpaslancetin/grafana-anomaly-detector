# Anomaly Detector - Elastic Parite ve Kapasite Demo Sonuclari

Tarih: 2026-03-27

## 1. Amac

Bu dokuman iki ana soruya cevap vermek icin olusturuldu:

1. Mevcut Grafana tabanli anomaly detector cozumumuz, Elastic Machine Learning benzeri enterprise anomaly detection yaklasimina ne kadar yaklasiyor?
2. Mevcut lab ortaminda detector sayisi arttikca cozumun guvenli siniri nereye kadar uzaniyor?

Bu cevaplar, yalnizca teorik bir degerlendirme ile degil, gercek benchmark scriptleri ve calistirilmis demo ciktilari ile desteklenmektedir.

## 2. Kullanilan Demo Ciktilari

- Functional baseline benchmark:
  [functional_benchmark_summary.json](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/functional/outputs/functional_benchmark_summary.json)
- Functional tuning sweep:
  [functional_tuning_sweep_summary.json](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/functional/outputs/functional_tuning_sweep_summary.json)
- Detector scale smoke:
  [detector_scale_smoke_summary.json](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/performance/outputs/detector_scale_smoke_summary.json)
- Detector scale extended:
  [detector_scale_extended_summary.json](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/performance/outputs/detector_scale_extended_summary.json)

Destekleyici raporlar:

- [functional_benchmark_report.md](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/functional/outputs/functional_benchmark_report.md)
- [functional_tuning_sweep_report.md](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/functional/outputs/functional_tuning_sweep_report.md)
- [detector_scale_smoke_report.md](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/performance/outputs/detector_scale_smoke_report.md)
- [detector_scale_extended_report.md](C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/benchmarks/performance/outputs/detector_scale_extended_report.md)

## 3. Yonetici Ozeti

Bugunku test sonucuna gore:

- Varsayilan ayarlarla enterprise parity iddiasi yapamayiz.
- Ancak mevcut algoritma seti icinde tuning yapildiginda 5 senaryonun 4'unde enterprise hedef profiline yaklasilabiliyor.
- En zayif alan seasonal anomaly detection olmaya devam ediyor.
- Kapasite tarafinda detector-side guvenli limit bu lab kosusunda `500 dynamic detector` olarak gorundu.
- `600 dynamic detector` seviyesinde evaluation suresi belirledigimiz guvenli esigi gecti.
- Operasyonel prod ceiling icin bugunku en dogru onerim `350-400 dynamic detector` araligidir.

## 4. Elastic Benzeri Yetkinliklere Gore Karsilastirma

Bu kisimda Elastic resmi dokumanlarindaki anomaly detection yetkinlikleri referans alindi.

Kaynaklar:

- [Elastic anomaly detection overview](https://www.elastic.co/docs/explore-analyze/machine-learning/anomaly-detection)
- [Elastic job types](https://www.elastic.co/docs/explore-analyze/machine-learning/anomaly-detection/ml-anomaly-detection-job-types)
- [Elastic population analysis](https://www.elastic.co/docs/explore-analyze/machine-learning/anomaly-detection/ml-configuring-populations)
- [Elastic forecasting](https://www.elastic.co/docs/explore-analyze/machine-learning/anomaly-detection/ml-ad-forecast)
- [Elastic model memory estimation](https://www.elastic.co/guide/en/elasticsearch/reference/current/ml-estimate-model-memory.html)
- [Elastic anomaly score explanation](https://www.elastic.co/docs/explore-analyze/machine-learning/anomaly-detection/ml-ad-explain)
- [Elastic anomaly detection at scale](https://www.elastic.co/guide/en/machine-learning/current/anomaly-detection-scale.html)

| Yetkinlik | Elastic ML | Bizim Cozum | Durum |
| --- | --- | --- | --- |
| Tek metrik uzerinde baseline kurma | Var | Var | Karsiliyor |
| Expected band / deviation gosterimi | Var | Var | Karsiliyor |
| Farkli algoritma secimi | Geniş job/detector fonksiyonlari | MAD / EWMA / Z-score / Seasonal | Kismen karsiliyor |
| Multi-metric job | Var | Panel/score toplama mantigi var ama Elastic seviyesinde job modeli yok | Kismen karsiliyor |
| Influencer mantigi | Var | Sinirli; entity-level acik influencer modeli yok | Eksik |
| Population analysis | Var | Yok | Eksik |
| Categorization / log pattern anomaly | Var | Yok | Eksik |
| Rare / freq_rare tespiti | Var | Yok | Eksik |
| Geo anomaly | Var | Yok | Eksik |
| Forecasting | Var | Yok | Eksik |
| Bucket / Record / Influencer result tipleri | Var | Series ve rule score var | Kismen karsiliyor |
| Rich explainability | Probability, anomaly score explanation, multi-bucket impact | Expected, lower-upper band, deviation, normalized score | Kismen karsiliyor |
| Model memory estimate / scaling controls | Var | Manuel benchmark ile tahmin ediyoruz | Eksik |
| Alerting entegrasyonu | Var | Var | Karsiliyor |

## 5. Fonksiyonel Sonuclar - Bugunku Cevap

### 5.1 Varsayilan ayarlarla basari seviyesi

Varsayilan benchmark sonucu:

| Metrik | Sonuc |
| --- | --- |
| Ortalama precision | 0.3417 |
| Ortalama recall | 1.0 |
| Ortalama F1 | 0.4903 |
| Ortalama false positive rate | 0.1011 |
| Enterprise hedef profiline uyan senaryo | 0 / 5 |

Yorum:

- Sistem anomaly kacirmiyor.
- Ancak anomaly fazla uretiyor.
- Yani recall guclu, precision zayif.
- Bu haliyle Elastic ML ile ayni basari seviyesindeyiz diyemeyiz.

### 5.2 Tuning sonrasi ulasilabilen seviye

Tuning sweep sonucu:

| Metrik | Varsayilan | Tuned |
| --- | --- | --- |
| Ortalama precision | 0.3417 | 0.8667 |
| Ortalama recall | 1.0 | 1.0 |
| Ortalama F1 | 0.4903 | 0.9 |
| Ortalama false positive rate | 0.1011 | 0.0042 |
| Enterprise hedef profiline uyan senaryo | 0 / 5 | 4 / 5 |

### 5.3 Use case bazli sonuc

| Senaryo | Default durum | Tuned durum | Hukum |
| --- | --- | --- | --- |
| `latency_spike_mad` | Precision 0.4, F1 0.5714 | Precision 1.0, F1 1.0 | Enterprise-hedefe yakin |
| `error_burst_mad` | Precision 0.4167, F1 0.5882 | Precision 1.0, F1 1.0 | Enterprise-hedefe yakin |
| `traffic_drop_ewma` | Precision 0.35, F1 0.5185 | Precision 1.0, F1 1.0 | Enterprise-hedefe yakin |
| `seasonal_hourly_spike` | Precision 0.0714, F1 0.1333 | Precision 0.3333, F1 0.5 | Hala zayif |
| `resource_step_ewma` | Precision 0.4706, F1 0.64 | Precision 1.0, F1 1.0 | Enterprise-hedefe yakin |

### 5.4 Fonksiyonel hukmum

Bugunku delile gore:

- Basit univariate anomaly use case'lerinde cozumumuz iyi tuning ile Elastic'e yakin bir operasyonel kaliteye gelebiliyor.
- Seasonal davranis, population-level analiz, influencer mantigi ve forecasting gibi alanlarda enterprise urun yetkinligine henuz ulasmiyor.
- Bu nedenle dogru ifade su olur:

`Tam Elastic parity yok, ancak secili operasyonel use case'lerde tuning ile yaklasilabiliyor.`

## 6. Kapasite Sonuclari - Bugunku Cevap

### 6.1 Ilk smoke

Ilk testte 50 dynamic detector'a kadar hicbir sert bozulma gorulmedi.

### 6.2 Genisletilmis kapasite testi

Genisletilmis detector-side test sonucu:

| Dynamic detector | Eval duration (s) | Scrape success | Yorum |
| --- | --- | --- | --- |
| 500 | 1.151905 | 1.0 | Guvenli |
| 600 | 1.598743 | 1.0 | Guvenli esigi asti |

Bu kosuda guvenli esik su sekilde tanimlandi:

- `last_scrape_success = 1`
- `evaluation_duration_seconds <= 1.5`

Bu kritere gore:

- Test edilmis guvenli detector-side limit: `500 dynamic detector`
- 600 seviyesinde guvenli esik asildi

### 6.3 Kaynak tuketimi gozlemi

3 -> 500 dynamic detector gecisinde gozlenen artış:

| Bilesen | 3 detector | 500 detector | Artis | Detector basi artis |
| --- | --- | --- | --- | --- |
| Exporter RSS | 28,544 KB | 46,228 KB | 17,684 KB | ~35.58 KB |
| Prometheus RSS | 123,160 KB | 177,428 KB | 54,268 KB | ~109.19 KB |
| Grafana RSS | 296,872 KB | 297,180 KB | 308 KB | Ihmal edilebilir |
| Evaluation duration | 0.016383 s | 1.151905 s | 1.135522 s | ~2.285 ms |

500 -> 600 detector araliginda:

- evaluation artis hizi ~`4.468 ms / detector`
- exporter metrics latency `0.0122 s` -> `0.1113 s`

Bu, yuk artikca evaluation cost'un lineer olmakla birlikte hizlandigini ve 500 sonrasinda headroom'un daraldigini gosteriyor.

### 6.4 Kapasite hukmu

Bugunku kosuda:

- `Hard tested detector-side limit = 500 dynamic detector`
- `Operationally recommended ceiling = 350-400 dynamic detector`

Bu operasyonel ceiling onerisi su nedenle daha dogru:

- render/load/alert soak henuz ayni deneyde birlikte kosulmadı
- 500 seviyesinde headroom kaldi ama daraldi
- 600 seviyesinde evaluation guardrail asildi

## 7. Riskler ve Kisıtlar

- Elastic ile birebir runtime karsilastirmasi henuz yapilmadi.
- Bugunku functional parity sonucu, Elastic dokumanindaki enterprise beklentilere hizalanmis hedef profile karsi olculdu.
- Browser-side dashboard render ve panel interactivity yuku bu testte ana eksen degildi.
- Gercek alert evaluation + notification + render + dashboard usage ayni anda soak kosulmadi.
- Seasonal senaryo halen en zayif halka.
- 500 detector stage'inde `rule_score_series` sayisinin `config_rule_count` ile tam hizalanmamasi, metriklerin tam settle olmadan alindigina isaret ediyor olabilir.

## 8. Sonuc

Iki ana soruya bugunku net cevap:

1. `Elastic anomaly detection seviyesinde miyiz?`
   Hayir, tam olarak degiliz.
   Ancak secili operasyonel tek-metrik use case'lerde tuning ile cok yaklasabiliyoruz.
   Seasonal ve enterprise-advanced capability tarafinda halen acik var.

2. `Bizim sinirimiz nedir?`
   Bu lab ortaminda detector-side guvenli limit `500 dynamic detector`.
   Operasyonel acidan emniyetli planlama limiti ise bugun icin `350-400 dynamic detector`.

## 9. Aksiyon Onerisi

1. Ayni labeled senaryolari gercek Elastic job'larinda kostur ve birebir vendor-to-vendor tabloyu doldur.
2. Seasonal model tarafina yeni varyasyon ekle:
   `weekday_hour`, adaptive threshold, trend + seasonality ayrimi.
3. 350-400 detector seviyesinde en az 8 saat soak kos:
   alerting + render + dashboard acik.
4. Entity/influencer benzeri baglamsal aciklama katmani ekle.
5. Sonra ikinci karar noktasi ac:
   `use case bazli Elastic alternatif olma` vs `tam enterprise parity`.
