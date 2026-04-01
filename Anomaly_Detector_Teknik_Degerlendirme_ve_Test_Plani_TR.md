# Anomaly Detector Cozumu Icin Teknik Degerlendirme ve Test Plani

Tarih: 2026-03-27
Surum: 1.0

## 1. Amac

Bu dokumanin amaci, Grafana tabanli Anomaly Detector cozumunun:

- enterprise anomaly detection urunlerine karsi fonksiyonel yeterliligini,
- operasyonel kullanimda olceklenebilirligini,
- Grafana instance, veri kaynagi ve alerting zinciri uzerindeki etkisini,
- guvenli kapasite limitini

olcmek icin uygulanabilir, tekrarlanabilir ve yonetim tarafina raporlanabilir bir test cercevesi ortaya koymaktir.

Bu calismanin ana sorusu sudur:

`Belirli bir kapsam dahilinde, kendi anomaly detector cozumumuz enterprise bir urune yeterince yakin sonuc uretiyor mu ve bunu operasyonel olarak hangi limite kadar kesintisiz calistirabiliyoruz?`

## 2. Kapsam

Bu plan iki ana ekseni kapsar:

1. Fonksiyonel yeterlilik / yetkinlik karsilastirmasi
2. Performans / olcek / kaynak kullanimi analizi

Kapsama dahil olan cozum:

- Grafana icinde calisan custom anomaly detection paneli
- zscore, MAD, EWMA ve seasonal algoritmalari
- expected line / expected band gorsellestirmesi
- anomaly detail / selected anomaly inceleme akisi
- Prometheus anomaly score feed ve Grafana Alerting entegrasyonu

Kapsama dahil olmayan veya ancak sinirli sekilde degerlendirilecek alanlar:

- log categorization
- NLP tabanli anomali
- tam otomatik root cause analysis
- forecasting odakli capacity prediction
- event correlation / topology-aware causal graph
- vendor-grade model governance ve lifecycle otomasyonu

## 3. Varsayimlar

- Ortam Grafana tabanlidir.
- Cozum esas olarak metric tabanli anomaly detection icin kullanilacaktir.
- Detector tanimi, varsayilan olarak "bir anomaly panel tanimi" anlamina gelir.
- Operasyonel detector sayisi hesaplanirken uc farkli profil ayrica olculecektir:
  - `V1`: sadece panel gorsellestirme
  - `V2`: panel + score feed
  - `V3`: panel + score feed + alert rule
- Referans enterprise urun olarak Elastic Machine Learning benzeri bir metric anomaly detection yetenegi esas alinacaktir.
- "Enterprise ile ayni basari" ifadesi tum urun kapsami icin degil, tanimli kapsam icin degerlendirilecektir.

## 4. Yonetici Ozeti

Beklenen ilk teknik hipotez su sekildedir:

- Mevcut Grafana Anomaly Detector cozumu, tek metrik / duzenli sezonluluk / threshold bazli operasyonel anomaly detection alaninda yuksek yeterlilik gosterebilir.
- Ancak Elastic Machine Learning benzeri enterprise urunlerin population analysis, influencers, categorization, rare analysis, forecasting, model governance ve cross-entity explainability gibi alanlarinda dogal olarak eksik kalir.
- Bu nedenle dogru hedef "tam urun esdegerligi" degil, `belirli metric anomaly use case'lerinde kabul edilebilir parity` olmalidir.
- Performans tarafinda sinir deger, yalnizca Grafana ile belirlenmez; veri kaynagi, Prometheus scrape / rule zinciri, browser rendering ve alert evaluation maliyeti birlikte ele alinmalidir.

Karar onerisi:

- Fonksiyonel parity iddiasi yalnizca secili use case'ler icin yapilmalidir.
- Prod kapasitesi, detector sayisina gore degil detector profiline gore ilan edilmelidir.
- En az su uc cikti olmadan prod kapasite karari verilmemelidir:
  - parity scorecard
  - detector-basina kaynak modeli
  - guvenli ust limit karari

## 5. Referans Yetkinlik Modeli

Elastic Machine Learning benzeri enterprise anomaly detection urunlerinde tipik olarak su kabiliyetler beklenir:

| Yetkinlik | Enterprise referans beklentisi | Mevcut cozumde beklenen durum | Not |
| --- | --- | --- | --- |
| Tek metrik anomaly detection | Var | Yuksek | Dogrudan destekleniyor |
| Trend ve seasonality modelleme | Var | Orta-Yuksek | Seasonal refinement mevcut |
| Robust outlier handling | Var | Yuksek | MAD / EWMA ile guclu |
| Threshold adaptability | Var | Orta | Kural bazli tuning gerekli olabilir |
| Multi-series / grouped analysis | Var | Orta | Panel bazinda seri analizi var ancak tam population modeli yok |
| Population / peer-group anomaly | Var | Dusuk | Native population/job benzeri davranis yok |
| Rare event / rare category analysis | Var | Dusuk | Dogrudan destek yok |
| Log categorization | Var | Yok | Kapsam disi |
| Forecasting | Var | Dusuk-Yok | Dogrudan destek yok |
| Influencer / root-cause ranking | Var | Dusuk-Orta | Seri detaylari gorulebilir ama otomatik influencer yok |
| Explainability | Var | Orta-Yuksek | actual / expected / deviation gosteriliyor |
| Alerting operability | Var | Yuksek | Score feed + Grafana Alerting mevcut |
| Model lifecycle / governance | Var | Dusuk | Versiyonlama ve merkezi model yonetimi yok |
| Enterprise supportability | Var | Orta | Operasyonel paketleme mevcut, vendor-grade destek yok |

## 6. Bolum A: Fonksiyonel Yeterlilik / Yetkinlik Karsilastirmasi

### 6.1 Degerlendirme sorusu

Degerlendirme sorusu sununla sinirlandirilmalidir:

`Mevcut Grafana tabanli anomaly detector, secili metric anomaly use case'lerinde, enterprise bir urune yakin dogruluk ve operasyonel kullanim degeri uretebiliyor mu?`

### 6.2 Karsilastirma matrisi

| Baslik | Elastic ML benzeri enterprise urun | Mevcut Grafana Anomaly Detector | Beklenen parity seviyesi | Karar notu |
| --- | --- | --- | --- | --- |
| Zaman serisi anomaly detection | Yerlesik | Var | Yuksek | Karsilastirma ana hedefi |
| Seasonal baseline | Yerlesik | Var | Orta-Yuksek | Dogrudan olculmeli |
| Robust anomaly scoring | Yerlesik | Var | Yuksek | MAD ve EWMA guclu aday |
| Outlier explainability | actual, typical, score, influencers | actual, expected, deviation, range | Orta | Influencer eksigi var |
| Dynamic thresholding | Model tabanli | Rule / tuning tabanli | Orta | Drift testleri gerekli |
| Population analysis | Var | Sinirli | Dusuk | Tam parity beklenmemeli |
| Rare/categorization | Var | Yok | Yok | Kapsam disi |
| Forecasting | Var | Yok/Sinirli | Yok | Kapsam disi |
| Root cause visibility | Influencers, entity-level insights | Seri / panel baglami | Dusuk-Orta | Yardimci ama otomatik degil |
| Alert integration | Yerlesik | Var | Yuksek | Guclu alan |
| Operasyonel deployability | Yuksek | Orta-Yuksek | Orta | Paketleme var, lifecycle limitli |

### 6.3 Olcum kriterleri

Fonksiyonel karsilastirma yalnizca tek bir accuracy degeri ile yapilmamalidir. Teknik ve is metrikleri birlikte kullanilmalidir.

#### Teknik metrikler

| Metrik | Tanim | Nasil olculur | Neden onemli |
| --- | --- | --- | --- |
| Precision | Uretilen anomaly alarmlarinin ne kadarinin gercek oldugu | TP / (TP + FP) | Ops yukunu belirler |
| Recall | Gercek anomaly'lerin ne kadarinin yakalandigi | TP / (TP + FN) | Kacirilan kritik olaylari gosterir |
| F1 score | Precision ve recall dengesi | 2PR / (P + R) | Dengeli karsilastirma |
| False positive rate | Gereksiz anomaly uretim orani | FP / toplam normal pencere | Alarm yorgunlugu riski |
| False negative rate | Kacirilan anomaly orani | FN / toplam gercek anomaly | Is riski |
| Detection delay | Olay basladiktan sonra yakalama suresi | anomaly detect time - event start | Erken uyari degeri |
| Seasonality fit | Dongusel davranis uzerinde normal/abnormal ayrimi | labeled seasonal dataset uzerinde precision/recall | Seasonality basarisini gosterir |
| Threshold adaptability | Baseline drift altinda kalite kaybi | threshold retune oncesi/sonrasi fark | Manuel operasyon ihtiyacini gosterir |
| Explainability completeness | anomaly kaydinda actual/expected/score/context gorulme orani | tum anomaly ornekleri icinde eksiksiz context yuzdesi | Inceleme hizi icin kritik |
| Root cause visibility | kullanicinin sorumlu seri/varligi bulma basarisi | zamanli kullanici testi veya entity hit rate | Operasyonel kullanislik |

#### Is / operasyon metrikleri

| Metrik | Tanim |
| --- | --- |
| Alarm basina analiz suresi | Bir anomaly alarmindan sonra anlamli sonuca ulasma suresi |
| Gereksiz escalasyon orani | Incident acilmamasi gereken alarm yuzdesi |
| Kaçirilan incident orani | Sonradan gercek incident oldugu anlasilan ama tespit edilmeyen olaylar |
| Uygulama ekip geri bildirimi | "anlamli / anlamsiz anomaly" degerlendirmesi |
| Rule tuning sikligi | Detector'i faydali tutmak icin gereken manuel ayar sayisi |

### 6.4 Olcum metodolojisi

Fonksiyonel testler uc veri sinifinda yapilmalidir:

1. Sentetik etiketli veri
2. Gecmis prod olay replay'i
3. Canli pilot veri

#### Veri setleri

| Veri seti | Amac | Icerik |
| --- | --- | --- |
| DS-1 Sentetik temel | Algoritma davranisini kontrollu gormek | spike, dip, level shift, trend drift |
| DS-2 Sentetik seasonality | Seasonal yetenekleri sinamak | gunluk, haftalik, is-gunu / saat bazli dongu |
| DS-3 Prod replay | Gercek olaylara yakin performans | bilinen incident pencereleri |
| DS-4 Noise / burst | False positive dayanikliligi | jitter, gap, scrape noise |
| DS-5 Multi-series | Coklu seri davranisi | pod, instance, region etiketli veri |

#### Etiketleme

- Incident ticket / postmortem ile eslesen zaman pencereleri `ground truth anomaly` olarak etiketlenmeli
- Normal maintenance, deploy ve planned jobs ayrica isaretlenmeli
- Bir anomaly tek timestamp degil, pencere olarak tanimlanmali

### 6.5 Test senaryolari

| ID | Senaryo | Amac | Basari sinyali |
| --- | --- | --- | --- |
| F-01 | Spike anomaly | Ani artis / dusus yakalama | yuksek recall, dusuk FP |
| F-02 | Slow drift | Yavas baseline kaymasi | kabul edilebilir detection delay |
| F-03 | Seasonal metric | Gunluk/haftalik pattern ustunde anomaly | normal donguyu anomaly sanmama |
| F-04 | Noise-heavy latency | Spiky latency metric | MAD bazli dayaniklilik |
| F-05 | Error burst | Kisa sureli hata patlamasi | kisa pencere anomaly tespiti |
| F-06 | Recovery / normalization | Incident bitisinde alarm susmesi | anomaly state'in gereksiz uzamama |
| F-07 | Multi-series panel | Cok seri icinde sorunlu seri gorunurlugu | offender seri bulunabilmeli |
| F-08 | Explainability review | Operatorden anomaly yorumu | actual/expected/deviation yeterli bulunmali |
| F-09 | Threshold adaptability | Baseline degisince manuel tuning ihtiyaci | sik retune gerekmemeli |
| F-10 | Alert usability | score feed ile rule olusturma | operasyona alinabilir akisin calismasi |

### 6.6 Basari kriterleri

Tam enterprise parity yerine iki seviyeli karar modeli onerilir.

#### Seviye 1: Scope parity

Su alanlarda parity aranir:

- single metric anomaly detection
- seasonal metric anomaly detection
- alerting operability
- analyst explainability

Minimum kriter:

| Kriter | Hedef |
| --- | --- |
| Precision | >= %80 |
| Recall | >= %75 |
| F1 | >= 0.77 |
| False positive | <= 0.2 / series-day veya referans urunden %20 kotu degil |
| Detection delay | referans urunden en fazla %20 daha kotu |
| Explainability completeness | >= %95 |
| Alert operational pass rate | %100 |

#### Seviye 2: Enterprise-near parity

Su ancak daha iddiali bir hedeftir:

| Kriter | Hedef |
| --- | --- |
| Precision | >= %85 |
| Recall | >= %80 |
| F1 | >= 0.82 |
| Seasonality fit | referans urune yakin, fark <= 5 puan |
| Detection delay | referans urune yakin, fark <= %10 |
| False positive | referans urunden en fazla %10 kotu |

Not:

- Population analysis
- categorization
- rare analysis
- forecasting
- influencer-based root cause

alanlarinda mevcut cozumde dogal gap oldugu icin bu alanlar parity iddiasina dahil edilmemelidir.

### 6.7 "Enterprise ile ayni basari" ifadesi nasil kullanilmali?

Su ifade yanlistir:

`Elastic ML ile tamamen ayni seviyedeyiz.`

Su ifade dogrudur:

`Secilen metric anomaly use case'lerinde, belirlenen veri setlerinde ve tanimli is metriklerinde enterprise referansa yakin basari elde edildi.`

### 6.8 Sonuclar nasil raporlanmali?

Fonksiyonel sonuc raporu su tablolari icermelidir:

#### A. Ozet scorecard

| Baslik | Sonuc | Hedef | Gecti/Kaldi |
| --- | --- | --- | --- |
| Precision |  |  |  |
| Recall |  |  |  |
| F1 |  |  |  |
| Detection delay |  |  |  |
| Seasonality fit |  |  |  |
| Explainability |  |  |  |
| Alert operability |  |  |  |

#### B. Senaryo bazli rapor

| Senaryo | Referans urun | Bizim cozum | Fark | Yorum |
| --- | --- | --- | --- | --- |

#### C. Gap listesi

| Gap | Etki | Oncelik | Cozum onerisi |
| --- | --- | --- | --- |

### 6.9 Riskler ve kisitlar

| Risk | Etki |
| --- | --- |
| Ground truth eksikligi | Precision/recall anlamsizlasir |
| Veri etiketleme hatasi | Yanlis karsilastirma yapilir |
| Use case secimi dar kalir | Yanlis parity algisi olusur |
| Population / categorization gibi alanlarin ayni sepete konmasi | Mevcut cozum haksiz sekilde zayif gorunur |
| Sadece sentetik veriyle karar verilmesi | Prod basarisi gercekci olmaz |

## 7. Bolum B: Performans / Olcek / Kaynak Kullanimi Analizi

### 7.1 Temel performans sorusu

`Grafana instance down olmadan, kabul edilebilir gecikme ve kaynak kullanimi icinde kac detector calistirabiliriz?`

Bu sorunun tek bir cevabi yoktur. Detector sayisi, detector profilinden bagimsiz olculurse yaniltici olur.

Bu nedenle uc profil ayri ayri test edilmelidir:

| Profil | Tanim |
| --- | --- |
| P1 | Panel-only detector |
| P2 | Panel + score feed detector |
| P3 | Panel + score feed + alert rule detector |

### 7.2 Olası darboğaz noktaları

| Katman | Muhtemel darboğaz |
| --- | --- |
| Grafana backend | query orchestration, alert scheduler, plugin execution |
| Browser / frontend | panel rendering, JS compute, cizim maliyeti |
| Veri kaynagi | Prometheus query latency, cardinality, range query maliyeti |
| Exporter | score hesaplama ve sync maliyeti |
| Prometheus | scrape, rule evaluation, TSDB cardinality |
| Renderer | screenshot / render istekleri |

### 7.3 Izlenecek metrik listesi

#### Sistem metrikleri

| Metrik | Neden |
| --- | --- |
| CPU usage % | Saturation gormek icin |
| Load average | Genel sistem baskisini gormek icin |
| RSS / working set memory | Detector basina memory etkisi |
| OOM / restart sayisi | Sert failure sinyali |
| Disk IO ve fs latency | SQLite, log ve temp etkisi |
| Network egress / ingress | Query ve alert zinciri etkisi |

#### Grafana metrikleri

| Metrik | Neden |
| --- | --- |
| HTTP request rate / latency | Kullanici etkisini gormek icin |
| Datasource query latency | Detector artisinda sorgu etkisi |
| Active sessions | Kullanici yukunun etkisi |
| Alert evaluation duration | Rule artisinda scheduler etkisi |
| Alert evaluation failures | Kapasite kirilimini gormek icin |
| Render duration / failures | Screenshot veya render etkisi |
| Plugin backend / panel related errors | Detector kod davranisi |

#### Prometheus / exporter metrikleri

| Metrik | Neden |
| --- | --- |
| scrape duration | Exporter maliyeti |
| scrape samples | Kardinalite artisina bakmak icin |
| rule evaluation duration | Score metric rule etkisi |
| TSDB series count | Detector basina time-series artis modeli |
| exporter response latency | Score feed hizmet sagligi |

#### Kullanici deneyimi metrikleri

| Metrik | Hedef |
| --- | --- |
| Dashboard load time p50/p95 | UI kabul edilebilirligi |
| Panel render time p50/p95 | Detector bazli deneyim |
| Save / sync latency | Operator verimliligi |

### 7.4 Test metodolojisi

Performans testleri dort fazda yapilmalidir:

1. Baseline
2. Load
3. Stress
4. Soak

#### Baseline

- 0 detector
- 1 detector
- 5 detector

Amac:

- bos sistem profilini gormek
- detector basina ilk artisi hesaplamak

#### Load test

Kademeli detector profili:

- 10
- 25
- 50
- 100
- 200
- 400
- 800

Her kademede:

- en az 20 dakika sabit calisma
- 10 dakika warm-up
- p50, p95, p99 gecikme olcumu

#### Stress test

Load testi gecildikten sonra:

- detector sayisi kapasite sinirina kadar artirilir
- ayni anda dashboard acma, kaydetme, alert evaluation ve score feed yukleri birlestirilir

Amac:

- kirilim noktasini bulmak
- hangi metrik once bozuluyor tespit etmek

#### Soak test

- secilen "guvenli ust limit"in %70-%80'i ile 8-24 saat calistirilir

Amac:

- memory leak
- gradual degradation
- exporter / Prometheus drift
- alert scheduler yorgunlugu

### 7.5 Test senaryolari

| ID | Senaryo | Amac | Basari sinyali |
| --- | --- | --- | --- |
| P-01 | Baseline idle | Bos profil cikarmak | Stabil CPU/RAM |
| P-02 | Linear detector ramp | Detector basina maliyeti bulmak | Yaklasik lineer artis |
| P-03 | Mixed dashboard load | Gercek kullanici davranisi | p95 load time hedefte |
| P-04 | Detector + alert rule | Alert scheduler etkisi | evaluation failure olmamali |
| P-05 | Spike / burst add | Ani detector artisina dayanma | restart / OOM olmamali |
| P-06 | Soak 8h+ | Uzun sureli stabilite | memory drift kontrol altinda |

### 7.6 Detector basina kaynak modeli

Asagidaki temel model kullanilmalidir:

- `DeltaCPU(n) = CPU(n) - CPU(0)`
- `DeltaRAM(n) = RAM(n) - RAM(0)`
- `CPU_per_detector = DeltaCPU(n) / n`
- `RAM_per_detector = DeltaRAM(n) / n`

Ancak tek lineer model yetmez. Ikinci dereceden etki kontrol edilmelidir:

- `CPU(n) = a + b*n + c*n^2`
- `Latency95(n) = x + y*n + z*n^2`

Eger `c` veya `z` anlamli sekilde buyuyorsa, sistem lineer degil, doygunluga gidiyor demektir.

### 7.7 Guvenli ust limit nasil belirlenmeli?

Maksimum detector sayisi ile guvenli detector sayisi ayni sey degildir.

Guvenli limit, ilk failure noktasinin altinda belirlenmelidir.

Onerilen karar mantigi:

1. Ilk sert failure noktasini bul
2. Ilk p95 bozulma noktasini bul
3. Ilk alert evaluation hata noktasini bul
4. Ilk memory runaway / swap noktasini bul
5. Bunlarin en erken olanini referans al
6. Guvenli prod limiti olarak bunun %60-%75'ini ilan et

Ornek:

- UI bozulma noktasi: 240 detector
- alert evaluation hata noktasi: 220 detector
- memory spike noktasi: 260 detector

Bu durumda teknik max 220 civari gorunse de, prod guvenli limit:

- `130 - 165 detector` bandi olarak ilan edilmelidir

### 7.8 Basari kriterleri

| Kriter | Hedef |
| --- | --- |
| Dashboard load p95 | baseline'a gore en fazla %50 artis |
| Datasource query p95 | kabul edilen SLO icinde kalmali |
| Alert evaluation failure | %0 veya ihmal edilebilir |
| OOM / crash | 0 |
| Soak test memory drift | <= %10 |
| Error rate | anlamli artis olmamali |

### 7.9 Sonuclar nasil raporlanmali?

#### A. Kapasite ozeti

| Profil | Test edilen max | Ilk bozulma | Teknik max | Guvenli max |
| --- | --- | --- | --- | --- |
| P1 |  |  |  |  |
| P2 |  |  |  |  |
| P3 |  |  |  |  |

#### B. Kaynak modeli

| Detector sayisi | CPU avg | CPU p95 | RAM | Query p95 | Alert eval p95 | Yorum |
| --- | --- | --- | --- | --- | --- | --- |

#### C. Kapanma / kirilim analizi

| Belirti | Detector seviyesi | Etkilenen katman | Kok neden adayi |
| --- | --- | --- | --- |

### 7.10 Riskler ve kisitlar

| Risk | Etki |
| --- | --- |
| Sadece Grafana'ya bakip Prometheus'u ihmal etmek | Yanlis kapasite karari |
| Browser compute etkisini ihmal etmek | UI tarafi gec anlasilir |
| Alert rule sayisini detector sayisindan ayirmamak | Sonuc karisir |
| Testte sentetik datasource kullanip prod latency'sini ihmal etmek | Fazla iyimser sonuc |
| Tek seferlik load testi yapmak | Soak kaynakli sorunlar kacirilir |

## 8. Aksiyon Onerileri

### Kisa vade

1. Detector profillerini standartlastirin: P1, P2, P3
2. Labeled test dataset havuzu olusturun
3. Parity scorecard ve load/stress dashboard'i once hazirlayin
4. En az 10 gercek incident replay senaryosu secin

### Orta vade

1. Threshold adaptability icin drift testleri ekleyin
2. Multi-series offender tespitini guclendirin
3. Root cause visibility icin entity ranking / top offender ozeti dusunun
4. Detector sync ve score feed tarafina kapasite korumalari ekleyin

### Uzun vade

1. Population-style analysis ihtiyaci varsa backend tarafli model dusunun
2. Forecasting veya anomaly explanation derinlesecekse panel disi servis mimarisi degerlendirin
3. Model governance, versioning ve audit trail ihtiyaci cikarsa ayri kontrol katmani tasarlayin

## 9. Karar Onerisi

Asagidaki karar modeli kullanilmalidir:

| Sonuc | Karar |
| --- | --- |
| Scope parity gecti, performans limiti yeterli | Kontrollu prod pilot |
| Scope parity gecti, performans limiti sinirli | Kapsami daraltarak rollout |
| Scope parity kaldi, ama operatif deger var | Internal tool / analyst aid olarak kullan |
| Performans yetersiz | Detector sayisini sinirla veya mimariyi ayir |
| Population / categorization ihtiyaci yuksek | Enterprise urun veya backend-heavy mimari gerekebilir |

Bu dokumana gore en dogru karar mekanizmasi sudur:

- `tam enterprise parity` yerine `use case bazli parity`
- `tek max detector sayisi` yerine `profil bazli guvenli limit`
- `tek accuracy skoru` yerine `teknik + operasyonel scorecard`

## 10. Beklenen Nihai Ciktilar

Bu plan uygulandiginda asagidaki teslimatlar uretilmelidir:

1. Fonksiyonel karsilastirma matrisi
2. Precision / recall / F1 / delay scorecard
3. Senaryo bazli parity raporu
4. Detector profiline gore kapasite tablosu
5. Detector basina CPU/RAM modeli
6. Guvenli prod ust limit karari
7. Risk ve aksiyon listesi

## 11. Kaynaklar

Harici resmi kaynaklar:

- Elastic subscription and capability overview: https://www.elastic.co/subscriptions
- Elastic machine learning documentation: https://www.elastic.co/docs/explore-analyze/machine-learning
- Grafana configuration reference: https://grafana.com/docs/grafana/latest/installation/configuration/
- Grafana image rendering: https://grafana.com/docs/grafana/latest/setup-grafana/image-rendering/
- Grafana reverse proxy guidance: https://grafana.com/tutorials/run-grafana-behind-a-proxy/

Yerel proje kaynaklari:

- README: `README.md`
- Turkish usage summary: `KULLANIM_OZETI_TR.md`
- Alerting guide: `ALERTING_TR.md`
- Panel source: `alpas-anomalydetector-panel/src/components/SimplePanel.tsx`
