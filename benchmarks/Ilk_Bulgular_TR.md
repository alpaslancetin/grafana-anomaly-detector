# Ilk Bulgular - Functional ve Capacity Smoke

Tarih: 2026-03-27

## 1. Bu turda ne calistirildi?

Iki ilk adim benchmark'i calistirildi:

1. `functional/run_functional_benchmark.py`
2. `performance/run_detector_scale_smoke.py`

Ilgili ham ciktilar:

- `functional/outputs/functional_benchmark_summary.json`
- `functional/outputs/functional_benchmark_report.md`
- `performance/outputs/detector_scale_smoke_summary.json`
- `performance/outputs/detector_scale_smoke_report.md`

## 2. Ana bulgular

### Fonksiyonel taraf

Mevcut ayarlarla cozum:

- anomaly'leri kacirmiyor
- fakat fazla anomaly uretiyor

Bu nedenle:

- recall cok yuksek
- precision dusuk

Ilk benchmark ozeti:

| Metrik | Sonuc |
| --- | --- |
| Ortalama precision | 0.3417 |
| Ortalama recall | 1.0 |
| Ortalama F1 | 0.4903 |
| Ortalama false positive rate | 0.1011 |
| Enterprise hedef profiline gecen senaryo | 0 / 5 |

Yorum:

- Sistem anomaly yakalama konusunda agresif
- Ancak enterprise-benzeri parity icin fazla false positive uretiyor
- En zayif alan seasonal senaryolar

Bu, bug degil; daha cok tuning / baseline davranisi konusu gibi gorunuyor.

### Kapasite smoke testi

Exporter ve Prometheus tarafinda ilk smoke testte:

- 3 dynamic rule -> eval duration ~0.016 s
- 10 dynamic rule -> eval duration ~0.040 s
- 25 dynamic rule -> eval duration ~0.092 s
- 50 dynamic rule -> eval duration ~0.192 s

Bu aralikta:

- scrape success bozulmadi
- rule metric sayisi beklendigi gibi lineer artti
- exporter process RSS kademeli ama kontrollu artti
- sert failure gorulmedi

## 3. Bu ne anlama geliyor?

### 3.1 Elastic benzeri basari acisindan

Bugunku sonuc:

- `henuz enterprise parity diyemeyiz`

Sebep:

- recall iyi
- precision ve F1 belirgin sekilde dusuk
- false positive kontrolu daha iyi hale getirilmeli
- seasonal anomaly davranisi daha cok iyilestirme istiyor

### 3.2 Kapasite acisindan

Bugunku sonuc:

- `50 dynamic detector seviyesine kadar exporter-side smoke testte sorun yok`

Ama henuz sunu diyemeyiz:

- Grafana'nin tam prod guvenli detector limiti 50+ / 100+ / 200+

Cunku bu ilk test:

- browser-side dashboard render yukunu
- tam Grafana panel sayisi etkisini
- gercek alert rule yogunlugunu
- uzun sureli soak davranisini

tam olarak olcmuyor.

## 4. Bu turdan sonra net teknik yorum

### Guclu yonler

- anomaly yakalama agresif ve hizli
- detection delay sifira yakin
- score feed / exporter tarafi calisiyor
- detector sayisi arttiginda ilk smoke testte lineer artis goruluyor

### Zayif yonler

- false positive yuksek
- enterprise parity hedefi icin precision dusuk
- seasonal davranis su an zayif halka
- kapasite testi henuz Grafana UI + alerting tam yuku temsil etmiyor

## 5. Sonraki zorunlu adimlar

1. Threshold / baseline tuning sweep calistir
2. Seasonal refinement varyasyonlarini ayri benchmark et
3. Ayni labeled senaryolari Elastic tarafinda da kostur
4. Vendor-to-vendor parity tablosunu doldur
5. Capacity smoke testini 100 / 200 / 400 detector kademelerine tası
6. Browser-side dashboard load ve Grafana alert evaluation'i ayni teste ekle
7. En az 8 saatlik soak kos

## 6. Karar durumu

Bugunku karar:

- `Go for benchmarking`
- `Not yet Go for enterprise parity claim`
- `Not yet Go for final capacity claim`

Yani:

- cozum test etmeye deger
- ama daha tuning ve vendor karsilastirmasi gerekiyor
- kapasite limiti icin daha derin test gerekli
