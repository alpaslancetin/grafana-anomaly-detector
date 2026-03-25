# Grafana Anomaly Alerting Kilavuzu

## Yeni urun akisi

Bu proje artik anomaly panel tanimlarini Prometheus'a score metric olarak besleyebilen urun-benzeri bir akis sunuyor.

Temel fikir:
1. User panelde anomaly tanimini yapar.
2. Panel bu tanimi anomaly exporter'a sync eder.
3. Exporter Prometheus icin alert-ready score metric'leri uretir.
4. Grafana Alerting bu score metric'lerini normal Prometheus metric'i gibi kullanir.

Bu sayede kullanici normal akista su dosyalara girmez:
- `prometheus.yml`
- `prometheus-live-demo/anomaly_exporter/rules.yml`

Bu dosyalar sadece ileri seviye veya ops tarafindan statik rule yonetimi icin kalir.

## Score feed mode'lar

Panel ayarlarinda yeni alan:
- `Score feed mode = Auto sync`
- `Score feed mode = Manual sync`
- `Score feed mode = Off`

### Auto sync
- Kaydedilmis dashboard tanimini baz alir.
- Dashboard save sonrasi exporter bu tanimi otomatik alip Prometheus score rule'larini gunceller.
- Pratikte exporter saved dashboard tanimini periyodik kontrol ederek gunceller; bu yuzden save sonrasi kisa bir gecikme normaldir.

### Manual sync
- Panel ustundeki `Prometheus score feed` kartinda bulunan `Sync score feed` butonunu kullanir.
- Unsaved degisikliklerle de calismak istendiginde faydalidir.

## Panelden alert'e uctan uca kullanim

1. Prometheus query'si olan anomaly panelini ac.
2. `Score feed mode = Auto sync` birak.
3. Dashboard'u kaydet.
4. Paneldeki `Prometheus score feed` kartina bak.
5. Kartta uretilen alert query'yi kopyala.
6. `Alerting -> Alert rules -> New alert rule` ekranina git.
7. Datasource olarak Prometheus'u sec.
8. Query alanina panelin verdigi score metric'ini yaz.
9. Threshold ekle, contact point bagla ve rule'u kaydet.

## Panelin verdigi query'ler

Sync basarili oldugunda panel kartinda iki tip query gorursun.

### Rule-level en pratik query

```promql
grafana_anomaly_rule_score{rule="checkout_latency_panel"}
```

Bunu genellikle su sekilde kullanirsin:
- `IS ABOVE 70`
- `For = 2m`

Bu en user-friendly secenektir.

### Series-level detay query

```promql
grafana_anomaly_score{rule="checkout_latency_panel"}
```

Bunu su durumlarda kullanirsin:
- instance bazli alert
- pod bazli alert
- seri bazli ayrim yapmak istedigin durumlar

## Score nasil yorumlanir?

- `grafana_anomaly_rule_score`: rule icin 0-100 alert-ready aggregate score
- `grafana_anomaly_score`: tek seri icin 0-100 normalize score
- `grafana_anomaly_score_raw`: algoritmanin ham skoru
- `grafana_anomaly_is_anomaly`: threshold asildiginda `1`

Pratik esik onerileri:
- `> 60` warning
- `> 75` high
- `> 90` critical

## Ornek Grafana alert rule

Query:
```promql
grafana_anomaly_rule_score{rule="checkout_error_rate_panel"}
```

Condition:
- `WHEN QUERY IS ABOVE 75`

For:
- `2m`

Onerilen labels:
- `team=platform`
- `severity=high`
- `signal=anomaly_score`

## Ne zaman rules.yml kullanmaliyim?

Cogu user icin gerekmez.

Ama su durumlarda faydali olabilir:
- dashboard disi, merkezi statik rule tanimlari
- ops tarafinin panelden bagimsiz rule yonetmek istemesi
- grafana panelinden hic gecmeyen servis-level baseline tanimlari

Yani yeni varsayilan yol panel sync yoludur; `rules.yml` artik ikincil ve ileri seviye yoldur.

## Teknik not

Auto sync saved dashboard tanimini baz aldigi icin su davranis normaldir:
- panelde degisiklik yaptin ama save etmedin -> auto sync eski kayitli paneli baz alir
- save ettin -> exporter yeni kayitli tanimi alip rule'u gunceller

Bu davranis bilerek secildi. Cunku production benzeri alert feed'in, kaydedilmis dashboard tanimi ile hizali olmasi daha guvenlidir.

## Minimal exporter kurulumu

Exporter artik son kullanici icin ayri bir release paketiyle gelir:
- `release/alpas-anomaly-alert-bundle.zip`

RHEL icin yeni varsayilan yol native systemd kurulumudur.

### 1. Native RHEL yolu
Kisa akis:
1. `sudo ./install-exporter-rhel.sh http://127.0.0.1:9090`
2. `sudo ./enable-local-prometheus-scrape-rhel.sh`
3. Panelden score feed sync yap
4. Grafana Alerting'de mevcut Prometheus datasource ile `grafana_anomaly_rule_score{rule="..."}` query'sini kullan

Avantaj:
- Docker gerekmez
- exporter servis gibi calisir
- host restart sonrasi systemd ile otomatik kalkar
- RHEL operasyon modeline daha uygundur

### 2. Remote Prometheus yolu
Eger Prometheus baska hostta ise exporter RHEL makinede calisabilir ama scrape job remote Prometheus tarafinda acilmalidir.
Bu durumda bundle icindeki `prometheus-scrape-job.yml.snippet` kullanilir.

### 3. Docker modu
Docker dosyalari bundle icinde kalir ama RHEL hedefi icin artik ikincil secenektir.

### Neden bu yol secildi?
Grafana Alerting anomaly score'u Prometheus query API uzerinden okumak zorunda. Bu nedenle exporter'in urettigi metric'lerin bir Prometheus tarafindan scrape edilmesi gerekir. RHEL ortaminda bunu en dogru sekilde native servis + Prometheus scrape modeli karsilar.
