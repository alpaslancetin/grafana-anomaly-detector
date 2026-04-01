# Anomaly Detector Icin Sonraki Adimlar ve Yol Haritasi

Tarih: 2026-03-27
Surum: 1.0

Ilgili ana dokuman:

- `Anomaly_Detector_Teknik_Degerlendirme_ve_Test_Plani_TR.md`

## 1. Amac

Bu dokumanin amaci, teknik degerlendirme planini uygulanabilir bir is planina cevirmektir.

Ana hedef:

- Fonksiyonel parity iddiasini kontrollu sekilde test etmek
- Performans ve kapasite limitini olcmek
- Sonuc uzerinden net bir `Go / Limited Go / No Go` karari vermek

## 2. Hedeflenen Son Kararlar

Bu yol haritasi sonunda asagidaki kararlar alinabilmelidir:

1. Cozum secili use case'lerde enterprise urune yeterince yakin mi?
2. Hangi detector profili prod icin uygun?
3. Guvenli detector limiti nedir?
4. Hangi eksikler kapanmadan genis rollout yapilmamali?

## 3. Calisma Modeli

Calisma alti is paketine bolunmelidir:

| Is paketi | Baslik | Cikti |
| --- | --- | --- |
| WP-1 | Test kapsam ve veri hazirligi | Use case listesi, etiketli veri seti |
| WP-2 | Referans ve baseline olcumu | Elastic benzeri referans scorecard ve baseline raporu |
| WP-3 | Olcum ve gozlemleme altyapisi | Test dashboard'lari, log ve metrik panelleri |
| WP-4 | Fonksiyonel parity testleri | Precision/recall/F1 karsilastirma raporu |
| WP-5 | Performans ve kapasite testleri | Load/stress/soak raporu, guvenli limit |
| WP-6 | Karar ve rollout hazirligi | Yonetici ozeti, karar notu, aksiyon listesi |

## 4. Onerilen Fazlar

### Faz 0 - Hazirlik

Amac:

- test ortamini sabitlemek
- rolleri netlestirmek
- veri ve scope'u sabitlemek

Teslimatlar:

- onayli test kapsam dokumani
- detector profilleri tanimi
- test ortami topolojisi

### Faz 1 - Veri ve Referans Hazirligi

Amac:

- fonksiyonel parity icin guvenilir karsilastirma seti olusturmak

Teslimatlar:

- labeled dataset
- incident replay listesi
- sentetik senaryo havuzu

### Faz 2 - Fonksiyonel Degerlendirme

Amac:

- cozumun hangi use case'lerde yeterli oldugunu sayisal olarak gostermek

Teslimatlar:

- parity scorecard
- gap listesi
- explainability degerlendirmesi

### Faz 3 - Performans ve Kapasite

Amac:

- detector profiline gore kapasite sinirlarini gormek

Teslimatlar:

- detector-resource modeli
- kirilim noktasi analizi
- guvenli ust limit

### Faz 4 - Karar ve Pilot

Amac:

- sonuc uzerinden kontrollu rollout karari vermek

Teslimatlar:

- yonetim ozeti
- pilot kapsami
- must-have iyilestirme listesi

## 5. 6 Haftalik Onerilen Uygulama Takvimi

| Hafta | Odak | Ana aktiviteler | Beklenen cikti |
| --- | --- | --- | --- |
| 1 | Scope ve setup | use case secimi, detector profil tanimi, test ortami sabitleme | onayli test kapsami |
| 2 | Veri hazirligi | sentetik veri, incident replay, labeling | labeled dataset v1 |
| 3 | Fonksiyonel testler | F-01..F-10 senaryolari, parity olcumleri | fonksiyonel ara rapor |
| 4 | Load test | baseline + kademeli detector artisi | load test ara raporu |
| 5 | Stress + soak | kirilim noktasi ve uzun sureli stabilite | kapasite ara raporu |
| 6 | Karar hazirligi | bulgularin birlestirilmesi, yonetim ozeti | final karar paketi |

## 6. Detayli Is Paketi Planı

### WP-1: Test kapsam ve veri hazirligi

Amac:

- hangi use case'lerin karar icin kritik oldugunu sabitlemek

Gorevler:

1. Ilk rollout'ta kapsama alinacak metric siniflarini sec
2. En kritik 10-15 gercek use case'i listele
3. Detector profilini sabitle:
   - `P1`: panel-only
   - `P2`: panel + score feed
   - `P3`: panel + score feed + alert rule
4. Basari kriterlerini ekiplerle mutabik kil

Girdiler:

- mevcut anomaly detector dokumani
- incident backlog
- uygulama ekip geri bildirimi

Ciktilar:

- onayli use case listesi
- test veri ihtiyac listesi
- detector profil tanimlari

### WP-2: Referans ve baseline olcumu

Amac:

- karsilastirmanin dayandigi referans noktasini sabitlemek

Gorevler:

1. Referans enterprise yetkinlik setini kesinlestir
2. Elastic benzeri urunden alinacak benchmark metriklerini tanimla
3. Bos ortam baseline'ini cikar:
   - CPU
   - RAM
   - query latency
   - dashboard load time

Ciktilar:

- baseline olcum raporu
- referans yetkinlik matrisi

### WP-3: Olcum ve gozlemleme altyapisi

Amac:

- testlerin olculebilir ve tekrarlanabilir olmasini saglamak

Gorevler:

1. Grafana performans dashboard'i hazirla
2. Prometheus / exporter / OS metriklerini tek bir test dashboard'inda topla
3. Load test sirasinda alinacak log ve event formatini standartlastir
4. Sonuc csv / json export formatini sabitle

Ciktilar:

- test gozlem dashboard'i
- standart sonuc formatlari
- log toplama kurali

### WP-4: Fonksiyonel parity testleri

Amac:

- enterprise urune yakinlik seviyesini olcmek

Gorevler:

1. F-01..F-10 fonksiyonel senaryolari calistir
2. Her senaryo icin:
   - precision
   - recall
   - F1
   - detection delay
   - false positive
   - false negative
   - explainability yorumu
3. Sonuclari referans urunle ayni tabloda topla

Ciktilar:

- fonksiyonel parity raporu
- karsilastirma matrisi
- eksik yetkinlik listesi

### WP-5: Performans ve kapasite testleri

Amac:

- detector sayisina gore guvenli ust limiti bulmak

Gorevler:

1. Baseline, load, stress, soak testlerini uygula
2. Her profil icin farkli detector kademeleri dene
3. Detector basina kaynak tuketim modelini hesapla
4. Ilk bozulma noktasini tespit et
5. Teknik max ve guvenli max'i ayir

Ciktilar:

- kapasite tablosu
- detector-resource modeli
- guvenli limit karari

### WP-6: Karar ve rollout hazirligi

Amac:

- teknik sonuculari operasyonel karara cevirmek

Gorevler:

1. Yonetim ozetini hazirla
2. Pilot rollout icin hedef ekipleri sec
3. Must-fix ve nice-to-have backlog'u ayir
4. `Go / Limited Go / No Go` karari icin steering notu hazirla

Ciktilar:

- karar notu
- pilot rollout plani
- iyilestirme backlog'u

## 7. Ilk 10 Somut Sonraki Adim

Bu bolum, dokuman sonrasinda hemen baslanacak kisa vadeli is listesidir.

1. Test kapsam toplantisini planla ve use case listesini onaylat.
2. P1, P2, P3 detector profillerini resmi olarak dokumante et.
3. Son 3-6 ay icindeki incident'lerden en az 10 replay senaryosu sec.
4. Labeled dataset icin olay pencerelerini ve normal pencereleri isaretle.
5. Grafana, exporter, Prometheus ve OS icin tek bir test gozlem dashboard'i kur.
6. Baseline olcumu al: detector yokken CPU, RAM, query latency, dashboard load.
7. Fonksiyonel senaryo setini sentetik veriyle bir kez kos.
8. Ilk parity scorecard taslagini olustur.
9. Load testte kullanilacak detector artisim planini sabitle.
10. Final rapor formatini daha testler baslamadan once kilitle.

## 8. Rollere Gore Sorumluluk Onerisi

| Rol | Ana sorumluluk |
| --- | --- |
| Grafana / Observability ekibi | plugin, score feed, dashboard ve alert testleri |
| Uygulama ekipleri | use case secimi, incident replay dogrulamasi |
| Platform / Sistem ekibi | CPU, RAM, OS ve host kapasite olcumu |
| QA / Perf ekibi | load, stress, soak senaryolari |
| Yonetim / karar verici | parity kapsami ve rollout karar onayi |

## 9. Karar Kapilari

### Gate-1: Teste baslama onayi

Sartlar:

- use case listesi onayli
- detector profili net
- baseline ortam hazir

### Gate-2: Fonksiyonel parity devam karari

Sartlar:

- en kritik use case'lerde kabul edilebilir precision/recall
- explainability kullanici tarafinda yetersiz bulunmuyor

### Gate-3: Performans pilot karari

Sartlar:

- guvenli detector limiti hesaplandi
- load/stress/soak sonucu kararlı
- alert evaluation ve query latency kabul edilebilir

### Gate-4: Prod rollout karari

Sartlar:

- parity kapsaminda `Go` veya `Limited Go`
- pilot kapsam ve detector limitleri tanimli
- must-fix backlog kapanmis veya kabul edilmis

## 10. Beklenen Teslimatlar

| Teslimat | Sahibi | Hedef zaman |
| --- | --- | --- |
| Test kapsam dokumani | Observability + uygulama ekipleri | Hafta 1 |
| Labeled dataset v1 | Uygulama ekipleri | Hafta 2 |
| Baseline raporu | Platform / Observability | Hafta 2 |
| Fonksiyonel parity raporu | Observability / QA | Hafta 3 |
| Performans ara raporu | QA / Platform | Hafta 4 |
| Stress/soak raporu | QA / Platform | Hafta 5 |
| Final karar paketi | Tum ekipler | Hafta 6 |

## 11. Basariyi Hızlandıracak Teknik Oneriler

1. Test ortamini prod'a olabildigince yakin tutun.
2. Detector sayisini degil detector profilini esas alin.
3. Sonuclari yalnizca tek bir accuracy metriği ile raporlamayin.
4. Grafana ve Prometheus tarafini birlikte olcun.
5. Kisa load test sonucuyla kapasite karari vermeyin; soak testi mutlaka kosun.
6. Population analysis gibi kapsama girmeyen alanlari parity iddiasina dahil etmeyin.

## 12. Onerilen Sonuc Formati

Final yonetim sunumunda su uc slayt mutlaka yer almalidir:

1. `Biz neyi enterprise ile karsilastirdik, neyi karsilastirmadik?`
2. `Hangi use case'lerde kabul edilebilir parity saglandi?`
3. `Guvenli detector limiti nedir ve hangi kosullarda gecerli?`

## 13. Karar Onerisi Cercevesi

| Durum | Onerilen hareket |
| --- | --- |
| Fonksiyonel parity iyi, kapasite yeterli | Kontrollu prod pilot |
| Fonksiyonel parity iyi, kapasite sinirli | Sinirli ekip rollout + detector limiti |
| Fonksiyonel parity kisitli, operatif deger var | Internal analyst araci olarak kullanim |
| Performans sorunlu | Mimari iyilestirme oncesi rollout yapma |

## 14. Sonuc

Bir sonraki adimlarin odagi yazilim gelistirme degil, kontrollu olcum ve karar uretme olmalidir.

Bu nedenle onerilen sira sununla sabitlenmelidir:

1. scope
2. veri
3. parity
4. kapasite
5. karar
6. pilot

En kritik prensip:

`Once parity kapsamini dogru tanimla, sonra kapasiteyi detector profiline gore olc, en son rollout karari ver.`
