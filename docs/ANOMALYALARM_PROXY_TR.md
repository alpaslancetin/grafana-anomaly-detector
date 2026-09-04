# /anomalyalarm reverse proxy kurulumu

Plugin/exporter 1.5.0, paket revizyonu 1.5.0-r1. Bu sayfa saha LB konfigunun
yerine gecmez; iki yonlendirme sekli yerel HTTPS reverse proxy ile dogrulandi.

## Onerilen akis

Panel Exporter endpoint: `/anomalyalarm` (Grafana ile ayni HTTPS origin).
Tarayici `https://grafana.example.com/anomalyalarm/api/sync/panel` adresine
istek gonderir. LB ozel agdaki exporter:9110 servisine proxy yapar.
Kullanicinin 9110 portuna dogrudan erismesi gerekmez.

### LB oneki kaldiriyorsa

`/anomalyalarm/api/sync/panel` -> `http://exporter:9110/api/sync/panel`

Mevcut exporter config dosyasinin `global` bolumunde:

```yaml
global:
  base_path: ''
```

### LB oneki koruyorsa

`/anomalyalarm/api/sync/panel` -> `http://exporter:9110/anomalyalarm/api/sync/panel`

```yaml
global:
  base_path: /anomalyalarm
```

Her iki durumda da devamindaki `/api/...` yolu ve query string korunmalidir.
Tum istekleri yalniz `/` adresine cevirmek yanlistir. Client tarafina 9110
adresine redirect degil, LB tarafinda reverse proxy gerekir. Grafana'nin
root_url veya serve_from_sub_path ayarini bu exporter yolu icin degistirmeyin.

Nginx `proxy_pass http://exporter:9110/;` eslesen location onekini `/` ile
degistirir; URI parcasi olmayan `proxy_pass http://exporter:9110;` ise yolu
korur. Kaynak: [resmi nginx proxy_pass dokumani](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_pass).

## Guvenlik ve LB sozlesmesi

- GET, POST, DELETE ve gerekiyorsa OPTIONS desteklenmeli; body/query string kaybolmamali.
- API cevabi cache'lenmemeli, 400/401/403/409/413/415/429/5xx cevaplari HTML login
  veya 200 cevabina donusturulmemeli. Endpoint'e tek basina erisebilmek sync kaniti degildir.
- LB uzerinde kimlik dogrulama VE yetkilendirme uygulanmali. Grafana oturumu,
  exporter API'sini otomatik korumaz. CORS kimlik dogrulama degildir.
- Exporter 9110 yalniz LB/izinli servislerden erisilebilir olmali. API token
  kullaniliyorsa LB, yetkili istek icin token'i enjekte etmeli; token dashboard'a yazilmamali.
- Origin allowlist Grafana'nin gercek origin'ini icermeli (path degil).
- Varsayilan exporter body limiti 1 MiB, API rate limiti peer IP basina 120/dakika.
  LB arkasinda kullanicilar ayni peer IP'yi paylasabilir: kapasiteyi olcun,
  kullanici bazli limiti LB'de uygulayin. X-Forwarded-For'a korlemesine guvenmeyin.
- HTTPS sertifika zinciri istemcide gecerli olmali. TLS guvenligini kapatmak cozum degildir.

## Kontrol

Yetkili istemciden (kurumunuzun auth mekanizmasi ile):

```bash
curl --fail-with-body https://grafana.example.com/anomalyalarm/api/capabilities
curl --fail-with-body https://grafana.example.com/anomalyalarm/health/ready
curl --fail-with-body https://grafana.example.com/anomalyalarm/health/dependencies
```

JSON ve version=1.5.0 bilgisi beklenir. Ready ve dependencies ayri incelenmelidir:
servis ayakta olsa bile kaynak veya sink erisimi bozuk olabilir. Panelden Sync score
feed yaptiginizda Network'te `/anomalyalarm/api/...` istekleri gorulmelidir.

19 API kontrolu her iki HTTPS proxy modunda gecti: capability/health/metrics,
preflight, kayit, idempotence, revision conflict, score feed, silme ve hatali
istekler. `scripts/proxy_contract_check.py` yalniz izole test exporter'i icindir;
uretimde calistirmayin. Gercek saha LB kabul testi, uzun sureli yuk ve kurum auth
kontrolu ayrica gereklidir. Request-ID/surum basliklari CORS expose ile tarayicidan
okunabilir; bu tanilama iyilestirmesi yol rewrite isleminin yerine gecmez.
