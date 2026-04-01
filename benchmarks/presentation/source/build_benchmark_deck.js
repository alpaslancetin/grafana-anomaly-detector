const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const {
  imageSizingContain,
  imageSizingCrop,
} = require("./pptxgenjs_helpers/image");
const { safeOuterShadow } = require("./pptxgenjs_helpers/util");
const {
  warnIfSlideHasOverlaps,
  warnIfSlideElementsOutOfBounds,
} = require("./pptxgenjs_helpers/layout");

const ShapeType = pptxgen.ShapeType || {
  rect: "rect",
  roundRect: "roundRect",
};
const ChartType = pptxgen.ChartType || {
  bar: "bar",
  line: "line",
};

const ROOT = path.resolve(__dirname, "..");
const SCREENSHOT_DIR = path.join(ROOT, "assets", "screenshots");
const OUTPUT_DIR = path.join(ROOT, "output");
const OUTPUT_FILE = path.join(
  OUTPUT_DIR,
  "Grafana_Anomaly_Detector_Benchmark_TR.pptx"
);

const SHOTS = {
  multi: path.join(SCREENSHOT_DIR, "grafana-multi-metric-premium.png"),
  single: path.join(SCREENSHOT_DIR, "grafana-single-metric-premium.png"),
  latency: path.join(SCREENSHOT_DIR, "benchmark-side-by-side-latency.png"),
  shift: path.join(SCREENSHOT_DIR, "benchmark-side-by-side-level-shift.png"),
  latencyDetector: path.join(SCREENSHOT_DIR, "grafana-latency-real.png"),
  latencyElastic: path.join(SCREENSHOT_DIR, "elastic-latency-real.png"),
  shiftDetector: path.join(SCREENSHOT_DIR, "grafana-levelshift-real.png"),
  shiftElastic: path.join(SCREENSHOT_DIR, "elastic-levelshift-real.png"),
};

const C = {
  bg: "08111F",
  panel: "0F1A2B",
  panelAlt: "122038",
  border: "22314B",
  soft: "30445F",
  text: "F7FAFC",
  muted: "B8C4D5",
  faint: "7D8CA2",
  orange: "F97316",
  amber: "F59E0B",
  blue: "38BDF8",
  green: "22C55E",
  red: "EF4444",
  yellow: "EAB308",
  cyan: "06B6D4",
  slate: "CBD5E1",
  white: "FFFFFF",
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function addBackground(slide) {
  slide.background = { color: C.bg };
  slide.addShape(ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    line: { color: C.bg, transparency: 100 },
    fill: { color: C.bg },
  });
  slide.addShape(ShapeType.rect, {
    x: 0.55,
    y: 0.32,
    w: 12.23,
    h: 0.03,
    line: { color: C.orange, transparency: 100 },
    fill: { color: C.orange },
  });
}

function addKicker(slide, text) {
  slide.addText(text, {
    x: 0.62,
    y: 0.12,
    w: 4.8,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 10,
    color: C.orange,
    bold: true,
    margin: 0,
  });
}

function addTitle(slide, title, subtitle) {
  slide.addText(title, {
    x: 0.62,
    y: 0.48,
    w: 7.2,
    h: 0.34,
    fontFace: "Aptos Display",
    fontSize: 24,
    bold: true,
    color: C.text,
    margin: 0,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.62,
      y: 0.9,
      w: 8.8,
      h: 0.32,
      fontFace: "Aptos",
      fontSize: 11,
      color: C.muted,
      margin: 0,
    });
  }
}

function addFooter(slide, slideNo) {
  slide.addText("Grafana Anomaly Detector | Final benchmark revizyonu", {
    x: 0.62,
    y: 7.12,
    w: 5.6,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 8,
    color: C.faint,
    margin: 0,
  });
  slide.addText(String(slideNo), {
    x: 12.3,
    y: 7.08,
    w: 0.4,
    h: 0.2,
    align: "right",
    fontFace: "Aptos",
    fontSize: 8,
    color: C.faint,
    margin: 0,
  });
}

function addPanel(slide, x, y, w, h, opts = {}) {
  slide.addShape(ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: opts.border || C.border, width: 1 },
    fill: { color: opts.fill || C.panel },
    shadow: opts.shadow === false ? undefined : safeOuterShadow("000000", 0.2, 45, 2, 1),
  });
}

function addStatCard(slide, x, y, w, h, title, value, note, accent) {
  addPanel(slide, x, y, w, h);
  slide.addText(title, {
    x: x + 0.18,
    y: y + 0.14,
    w: w - 0.36,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 9,
    color: C.muted,
    bold: true,
    margin: 0,
  });
  slide.addText(value, {
    x: x + 0.18,
    y: y + 0.38,
    w: w - 0.36,
    h: 0.3,
    fontFace: "Aptos Display",
    fontSize: 19,
    bold: true,
    color: accent || C.text,
    margin: 0,
  });
  slide.addText(note, {
    x: x + 0.18,
    y: y + 0.76,
    w: w - 0.36,
    h: h - 0.88,
    fontFace: "Aptos",
    fontSize: 9,
    color: C.muted,
    margin: 0,
    valign: "top",
  });
}

function addCalloutCard(slide, x, y, w, h, title, body, accent) {
  addPanel(slide, x, y, w, h, { fill: C.panelAlt });
  slide.addShape(ShapeType.roundRect, {
    x: x + 0.16,
    y: y + 0.16,
    w: 0.08,
    h: h - 0.32,
    rectRadius: 0.02,
    line: { color: accent, transparency: 100 },
    fill: { color: accent },
  });
  slide.addText(title, {
    x: x + 0.32,
    y: y + 0.16,
    w: w - 0.48,
    h: 0.22,
    fontFace: "Aptos",
    fontSize: 11,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide.addText(body, {
    x: x + 0.32,
    y: y + 0.42,
    w: w - 0.48,
    h: h - 0.54,
    fontFace: "Aptos",
    fontSize: 9,
    color: C.muted,
    margin: 0,
    valign: "top",
  });
}

function addSectionTag(slide, x, y, label, accent) {
  slide.addText(label, {
    x,
    y,
    w: 1.55,
    h: 0.3,
    fontFace: "Aptos",
    fontSize: 8,
    color: C.text,
    bold: true,
    align: "center",
    margin: 0,
    fill: { color: accent, transparency: 80 },
    line: { color: accent, transparency: 100 },
    radius: 0.08,
    valign: "mid",
  });
}

function addBulletList(slide, x, y, w, items, color = C.muted, fontSize = 11) {
  const runs = [];
  items.forEach((item) => {
    runs.push({
      text: item,
      options: {
        bullet: { indent: 12 },
        hanging: 3,
        breakLine: true,
      },
    });
  });
  slide.addText(runs, {
    x,
    y,
    w,
    h: Math.max(0.4, items.length * 0.28),
    fontFace: "Aptos",
    fontSize,
    color,
    margin: 0,
    breakLine: false,
    valign: "top",
  });
}

function addMetricExplainCard(slide, x, y, w, title, body, accent) {
  addPanel(slide, x, y, w, 0.95, { fill: C.panelAlt, shadow: false });
  slide.addText(title, {
    x: x + 0.16,
    y: y + 0.14,
    w: w - 0.32,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: accent,
    margin: 0,
  });
  slide.addText(body, {
    x: x + 0.16,
    y: y + 0.36,
    w: w - 0.32,
    h: 0.44,
    fontFace: "Aptos",
    fontSize: 9,
    color: C.muted,
    margin: 0,
    valign: "top",
  });
}

function addScenarioCompareRow(slide, cfg) {
  const {
    y,
    tag,
    accent,
    leftImage,
    rightImage,
    leftTitle,
    rightTitle,
    leftBadge,
    rightBadge,
    note,
  } = cfg;

  addSectionTag(slide, 0.84, y + 0.02, tag, accent);

  addPanel(slide, 0.78, y + 0.36, 4.18, 2.08);
  slide.addText(leftTitle, {
    x: 0.98,
    y: y + 0.52,
    w: 2.4,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 11,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide.addText(leftBadge, {
    x: 3.62,
    y: y + 0.5,
    w: 1.08,
    h: 0.24,
    fontFace: "Aptos",
    fontSize: 9,
    bold: true,
    color: C.green,
    align: "right",
    margin: 0,
  });
  slide.addImage({
    path: leftImage,
    ...imageSizingContain(leftImage, 0.98, y + 0.78, 3.78, 1.46),
  });

  addPanel(slide, 5.2, y + 0.36, 4.18, 2.08);
  slide.addText(rightTitle, {
    x: 5.4,
    y: y + 0.52,
    w: 2.1,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 11,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide.addText(rightBadge, {
    x: 7.98,
    y: y + 0.5,
    w: 1.2,
    h: 0.24,
    fontFace: "Aptos",
    fontSize: 9,
    bold: true,
    color: C.amber,
    align: "right",
    margin: 0,
  });
  slide.addImage({
    path: rightImage,
    ...imageSizingContain(rightImage, 5.4, y + 0.78, 3.78, 1.46),
  });

  addCalloutCard(slide, 9.62, y + 0.36, 3.03, 2.08, "Karsilastirmali yorum", note, accent);
}

function addSlideShell(slide, slideNo, kicker, title, subtitle) {
  addBackground(slide);
  addKicker(slide, kicker);
  addTitle(slide, title, subtitle);
  addFooter(slide, slideNo);
}

function validateSlide(slide, pptx) {
  warnIfSlideHasOverlaps(slide, pptx);
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

async function buildDeck() {
  ensureDir(OUTPUT_DIR);

  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "OpenAI Codex";
  pptx.company = "OpenAI";
  pptx.subject = "Grafana Anomaly Detector final benchmark presentation";
  pptx.title = "Grafana Anomaly Detector Benchmark";
  pptx.lang = "tr-TR";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "tr-TR",
  };

  const slide1 = pptx.addSlide();
  addBackground(slide1);
  slide1.addText("Grafana Anomaly Detector", {
    x: 0.7,
    y: 0.72,
    w: 5.7,
    h: 0.34,
    fontFace: "Aptos Display",
    fontSize: 26,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide1.addText("Final benchmark revizyonu ve Elastic side-by-side sonucu", {
    x: 0.7,
    y: 1.2,
    w: 5.9,
    h: 0.28,
    fontFace: "Aptos",
    fontSize: 12,
    color: C.muted,
    margin: 0,
  });
  slide1.addText(
    "Bu sunum, guncel plugin UX iyilestirmeleri sonrasinda ayni labeled dataset uzerinde ulasilan kaliteyi ve tasinabilen detector kapasitesini orijinal benchmark ciktilari ile gosterir.",
    {
      x: 0.7,
      y: 1.62,
      w: 5.25,
      h: 0.9,
      fontFace: "Aptos",
      fontSize: 11,
      color: C.muted,
      margin: 0,
      valign: "top",
    }
  );
  addSectionTag(slide1, 0.7, 2.62, "CANLI SONUC", C.orange);
  addBulletList(
    slide1,
    0.74,
    3.03,
    5.2,
    [
      "Final detector, 6 benchmark senaryosunun 6'sinda da basarili oldu.",
      "Ayni dataset uzerinde Elastic ML'in trial runtime sonucundan daha yuksek kalite olculdu.",
      "300, 350 ve 400 detector seviyeleri dashboard + render + alert query ile birlikte kisa soak testini gecti.",
    ],
    C.text,
    11
  );
  addStatCard(
    slide1,
    0.7,
    5.55,
    1.8,
    1.08,
    "Mean F1",
    "1.00",
    "Final detector sonucu",
    C.green
  );
  addStatCard(
    slide1,
    2.68,
    5.55,
    1.8,
    1.08,
    "Elastic best F1",
    "0.71",
    "Ayni dataset, en iyi threshold",
    C.amber
  );
  addStatCard(
    slide1,
    4.66,
    5.55,
    1.8,
    1.08,
    "Short soak",
    "400 PASS",
    "Dashboard + render + alert path acik",
    C.blue
  );
  addPanel(slide1, 6.78, 0.72, 5.85, 6.15, { fill: "0C1627" });
  slide1.addImage({
    path: SHOTS.multi,
    ...imageSizingCrop(SHOTS.multi, 6.92, 0.86, 5.57, 5.87),
  });
  slide1.addText("Orijinal Grafana screenshot'u", {
    x: 9.1,
    y: 0.98,
    w: 2.95,
    h: 0.4,
    fontFace: "Aptos",
    fontSize: 9,
    bold: true,
    color: C.text,
    align: "center",
    margin: 0,
    fill: { color: C.bg, transparency: 12 },
    line: { color: C.border, transparency: 100 },
    radius: 0.08,
    valign: "mid",
  });
  addFooter(slide1, 1);
  validateSlide(slide1, pptx);

  const slide2 = pptx.addSlide();
  addSlideShell(
    slide2,
    2,
    "KARAR OZETI",
    "Sonuc tek bakista",
    "Teknik olmayan paydaslarin hizli karar alabilmesi icin sade anlatimla hazirlanmistir."
  );
  addStatCard(slide2, 0.65, 1.45, 3.0, 1.2, "Fonksiyonel kalite", "6 / 6", "Tum labeled benchmark senaryolari final detector tarafinda dogru sekilde yakalandi.", C.green);
  addStatCard(slide2, 3.82, 1.45, 3.0, 1.2, "Elastic karsilastirma", "1.00 vs 0.71", "Ayni veri setinde final detector mean F1 sonucu, Elastic'in en iyi threshold sonucunun uzerinde.", C.orange);
  addStatCard(slide2, 7.0, 1.45, 2.6, 1.2, "Kapasite", "400 PASS", "Short soak sirasinda dashboard, render ve alert query birlikte temiz gecti.", C.blue);
  addStatCard(slide2, 9.78, 1.45, 2.9, 1.2, "Urun olgunlugu", "Canli demo hazir", "Premium chart, inspector ve olay takibi deneyimi benchmark sonrasinda urune alinmis durumda.", C.cyan);
  addCalloutCard(
    slide2,
    0.65,
    3.0,
    12.0,
    1.05,
    "Yonetim diliyle yorum",
    "Bugun elimizdeki delil su: Bu plugin sadece laboratuvar demosu degil. Ayni veri setinde enterprise alternatif ile yanyana kosulmus, sayisal ve gorsel olarak karsilastirilmis, sonra da kisa kapasite smoke testinden gecirilmis bir urun durumuna ulasmis durumda.",
    C.orange
  );
  addMetricExplainCard(slide2, 0.65, 4.45, 3.8, "Precision nedir?", "Alarm geldiginde gercekten problem var mi? Yani bos alarm ne kadar az?", C.green);
  addMetricExplainCard(slide2, 4.77, 4.45, 3.8, "Recall nedir?", "Gercek problemlerin ne kadarini yakalayabiliyoruz? Yani kacirma oranini anlatir.", C.blue);
  addMetricExplainCard(slide2, 8.89, 4.45, 3.76, "F1 nedir?", "Precision ve recall dengesini tek sayida toplar. Teknik olmayan ekipler icin 'genel basari skoru' gibi okunabilir.", C.orange);
  addMetricExplainCard(slide2, 0.65, 5.62, 12.0, "False positive rate nedir?", "Sistemin gereksiz yere operasyonu uyarmasi. Bizim final detector sonucunda benchmark ailesinde bu oran 0.0 cikti; yani bu test setinde bos alarm uretmedi.", C.red);
  validateSlide(slide2, pptx);

  const slide3 = pptx.addSlide();
  addSlideShell(
    slide3,
    3,
    "URUN DENEYIMI",
    "Yeni premium panelin goruntusu",
    "Asagidaki ekran goruntuleri dogrudan calisan lokal Grafana stack'inden alinmistir."
  );
  addPanel(slide3, 0.62, 1.38, 7.9, 5.48);
  slide3.addImage({
    path: SHOTS.multi,
    ...imageSizingContain(SHOTS.multi, 0.78, 1.54, 7.58, 5.16),
  });
  addCalloutCard(
    slide3,
    8.72,
    1.45,
    3.95,
    1.0,
    "Detected incidents",
    "Artik yalnizca isaretlenen noktayi degil, olaylarin zaman eksenindeki gruplanmis akisini da gosteriyoruz. Bu, operasyonda hizli tarama icin kritik.",
    C.orange
  );
  addCalloutCard(
    slide3,
    8.72,
    2.62,
    3.95,
    1.0,
    "Anomaly inspector",
    "Secilen olay icin beklenen deger, mevcut deger, confidence, veri kalitesi ve ana neden ayni kartta toplanir.",
    C.blue
  );
  addCalloutCard(
    slide3,
    8.72,
    3.79,
    3.95,
    1.0,
    "Chart okunabilirligi",
    "Crosshair, sabitlenen tooltip, incident ribbon, daha belirgin marker'lar ve zaman ekseni sayesinde takip daha net hale geldi.",
    C.green
  );
  addPanel(slide3, 8.72, 4.96, 3.95, 1.74, { fill: C.panelAlt });
  slide3.addText("Single metric gorunumu", {
    x: 8.92,
    y: 5.08,
    w: 1.8,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide3.addImage({
    path: SHOTS.single,
    ...imageSizingContain(SHOTS.single, 8.9, 5.34, 3.6, 1.18),
  });
  validateSlide(slide3, pptx);

  const slide4 = pptx.addSlide();
  addSlideShell(
    slide4,
    4,
    "BENCHMARK METODOLOJISI",
    "Ayni veri, ayni etiket, ayni kiyas mantigi",
    "Bu benchmark'i etkili yapan sey, iki tarafa da ayni labeled dataset'in uygulanmis olmasidir."
  );
  addCalloutCard(slide4, 0.68, 1.55, 2.8, 1.0, "1. Veri seti", "Alti adet labeled benchmark senaryosu uretildi: latency spike, error burst, traffic drop, seasonal spike, resource step-up ve subtle level shift.", C.orange);
  addCalloutCard(slide4, 3.58, 1.55, 2.8, 1.0, "2. Bizim detector", "Grafana panel ve exporter final runtime ayarlari ile ayni senaryolar tekrar kosuldu ve precision / recall / F1 olculdu.", C.blue);
  addCalloutCard(slide4, 6.48, 1.55, 2.8, 1.0, "3. Elastic ML", "Ayni veri local Elastic trial runtime'a yuklendi. Gercek record export'u alinip threshold sweep yapildi.", C.green);
  addCalloutCard(slide4, 9.38, 1.55, 2.95, 1.0, "4. Karsilastirma", "Sayisal metrikler ve davranis grafigi ayni raporda birlestirildi. Boylece 'kim daha yakin' sorusu gorsel olarak da cevaplandi.", C.amber);
  addCalloutCard(
    slide4,
    0.68,
    3.0,
    5.78,
    3.1,
    "Neden guvenilir benchmark?",
    "Iki tarafa da ayni senaryo ailesi, ayni zaman serisi ve ayni anomaly etiketleri uygulandi. Bu sayede sonucta veri farki degil, detector davranisi olculmus oldu. Ayni benchmark raporunda hem sayisal metrik hem de gorsel davranis birlikte tutuldu.",
    C.orange
  );
  addCalloutCard(
    slide4,
    6.72,
    3.0,
    5.96,
    3.1,
    "Elastic kosu ayrintisi",
    "Elastic tarafi local trial runtime uzerinde gercek ML job olarak kosuldu. Record export'u alinip threshold sweep 1.0 ile 75.0 arasinda yapildi. Boylece 'varsayilan threshold' degil, Elastic'in bu dataset icin bulabildigi en iyi nokta da olculmus oldu.",
    C.blue
  );
  validateSlide(slide4, pptx);

  const slide5 = pptx.addSlide();
addSlideShell(
  slide5,
  5,
  "GORSEL KANIT",
  "Ayni dataset uzerinde 1-1 sistem karsilastirmasi",
  "Her satirda ayni benchmark senaryosu icin gercek Grafana paneli ve gercek Elastic ML ekran goruntusu birlikte okunur."
);
  addScenarioCompareRow(slide5, {
    y: 1.45,
    tag: "LATENCY SPIKE",
    accent: C.orange,
    leftImage: SHOTS.latencyDetector,
    rightImage: SHOTS.latencyElastic,
    leftTitle: "Grafana Anomaly Detector",
    rightTitle: "Elastic ML",
    leftBadge: "F1 1.00",
    rightBadge: "F1 0.57",
    note:
      "Bizim detector burst'u tek incident gibi net ayiriyor ve beklenen banttan kopusu daha temiz gosteriyor. Elastic ayni bolgeyi yakaliyor ancak score threshold secimine daha bagimli ve genel basari daha dusuk.",
  });
  addScenarioCompareRow(slide5, {
    y: 4.0,
    tag: "LEVEL SHIFT",
    accent: C.blue,
    leftImage: SHOTS.shiftDetector,
    rightImage: SHOTS.shiftElastic,
    leftTitle: "Grafana Anomaly Detector",
    rightTitle: "Elastic ML",
    leftBadge: "F1 1.00",
    rightBadge: "F1 0.87",
    note:
      "Kalici seviye kaymasinda bizim detector baseline kirilmasini daha istikrarli izliyor. Elastic ayni pencereyi goruyor ama daha parca parca tepki veriyor ve toplam kalite final detector'un gerisinde kaliyor.",
  });
  validateSlide(slide5, pptx);

  const slide6 = pptx.addSlide();
  addSlideShell(
    slide6,
    6,
    "SAYISAL KIYAS",
    "Final detector vs Elastic ML",
    "Sayisal sonuc, gorsel benchmarkta gozlenen farki dogruluyor."
  );
  slide6.addChart(
    ChartType.bar,
    [
      { name: "Final detector", labels: ["Precision", "Recall", "F1"], values: [1.0, 1.0, 1.0] },
      { name: "Elastic standard", labels: ["Precision", "Recall", "F1"], values: [0.3333, 0.0972, 0.1367] },
      { name: "Elastic best", labels: ["Precision", "Recall", "F1"], values: [0.8043, 0.6496, 0.7067] },
    ],
    {
      x: 0.76,
      y: 1.55,
      w: 6.55,
      h: 4.55,
      catAxisLabelFontFace: "Aptos",
      catAxisLabelFontSize: 10,
      valAxisLabelFontFace: "Aptos",
      valAxisLabelFontSize: 9,
      valAxisMinVal: 0,
      valAxisMaxVal: 1.05,
      valAxisNumFmt: "0.0",
      showLegend: true,
      legendFontFace: "Aptos",
      legendFontSize: 9,
      legendPos: "b",
      showTitle: false,
      showValue: false,
      showCatName: false,
      showSerName: false,
      gridLine: { color: "25364F", width: 1 },
      chartColors: [C.green, C.red, C.amber],
      gapWidth: 70,
      fontFace: "Aptos",
      lineSize: 1,
      showBorder: false,
    }
  );
  addPanel(slide6, 7.6, 1.55, 5.05, 2.3);
  slide6.addText("Senaryo bazli karar", {
    x: 7.82,
    y: 1.72,
    w: 1.8,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 11,
    bold: true,
    color: C.text,
    margin: 0,
  });
  addBulletList(
    slide6,
    7.82,
    2.05,
    4.5,
    [
      "Latency spike: Final detector one gecti",
      "Error burst: Final detector one gecti",
      "Traffic drop: Final detector one gecti",
      "Seasonal hourly spike: esit kalite",
      "Resource step-up: Final detector one gecti",
      "Subtle level shift: Final detector one gecti",
    ],
    C.muted,
    10
  );
  addCalloutCard(
    slide6,
    7.6,
    4.05,
    5.05,
    2.0,
    "Sade yorum",
    "Elastic'in seasonal use case'te guclu oldugu goruluyor. Ancak benchmark ailesinin genelinde final detector daha yuksek precision, recall ve F1 uretiyor. Bu nedenle bugun icin 'yakiniz' degil, 'bu dataset'te ondeyiz' demek daha dogru.",
    C.orange
  );
  validateSlide(slide6, pptx);

  const slide7 = pptx.addSlide();
  addSlideShell(
    slide7,
    7,
    "KAPASITE VE SOAK",
    "Kisa operasyonel limit resmi",
    "Bu slayt short soak ve scale testlerini ayni yerde ozetler."
  );
  slide7.addChart(
    ChartType.line,
    [
      {
        name: "Eval duration (s)",
        labels: ["75", "100", "150", "200", "300", "400"],
        values: [0.189857, 0.243183, 0.382123, 0.527709, 0.913882, 1.020447],
      },
    ],
    {
      x: 0.76,
      y: 1.55,
      w: 6.3,
      h: 4.75,
      catAxisLabelFontFace: "Aptos",
      catAxisLabelFontSize: 10,
      valAxisLabelFontFace: "Aptos",
      valAxisLabelFontSize: 9,
      valAxisMinVal: 0,
      valAxisMaxVal: 1.4,
      valAxisNumFmt: "0.0",
      showLegend: false,
      showTitle: false,
      showValue: false,
      showCatName: false,
      showSerName: false,
      gridLine: { color: "25364F", width: 1 },
      chartColors: [C.blue],
      lineSize: 2,
      showMarker: true,
      markerSize: 6,
      showBorder: false,
    }
  );
  addStatCard(slide7, 7.55, 1.55, 1.55, 1.08, "300 detector", "PASS", "Ortalama eval 0.76s", C.green);
  addStatCard(slide7, 9.28, 1.55, 1.55, 1.08, "350 detector", "PASS", "Ortalama eval 0.87s", C.green);
  addStatCard(slide7, 11.01, 1.55, 1.55, 1.08, "400 detector", "PASS", "Ortalama eval 1.09s", C.orange);
  addCalloutCard(slide7, 7.55, 3.0, 5.01, 1.18, "Short soak sonucu", "Dashboard check, render check ve alert-ready query birlikte acikken 300, 350 ve 400 detector seviyeleri 75 saniyelik smoke testte temiz gecti.", C.blue);
  addCalloutCard(slide7, 7.55, 4.42, 5.01, 1.18, "Ne demiyoruz?", "Bu sonuc 'prod ceiling kesin 400' demek degil. Dogru cikarim su: 400 seviyesi kisa smoke'ta temiz; kalici ceiling icin uzun soak gerekli.", C.amber);
  addCalloutCard(slide7, 7.55, 5.84, 5.01, 0.76, "Operasyon onerisi", "Kisa vadede 350-400 araligi guvenli planlama bandi olarak alinabilir.", C.green);
  validateSlide(slide7, pptx);

  const slide8 = pptx.addSlide();
  addSlideShell(
    slide8,
    8,
    "SON KARAR VE SONRAKI ADIM",
    "Bu benchmark sonunda ne soyleyebiliriz?",
    "Teknik ekip ve yonetim icin karar metni ayni slaytta toplanmistir."
  );
  addCalloutCard(slide8, 0.7, 1.55, 5.85, 1.2, "Bugunku karar", "Grafana Anomaly Detector, bu benchmark ailesinde Elastic ML trial runtime'ina yakin degil; onu gecen bir kalite sergiliyor. Ustelik bu sonuc gorsel benchmark, sayisal benchmark ve regresyon zinciri ile birlikte dogrulaniyor.", C.orange);
  addCalloutCard(slide8, 0.7, 3.0, 5.85, 1.2, "Urun etkisi", "Premium chart deneyimi sayesinde teknik olmayan kullanicilar da anomaly'yi daha kolay okuyabiliyor. Bu, benchmark basarisini dogrudan kullanici algisina tasiyor.", C.blue);
  addCalloutCard(slide8, 0.7, 4.45, 5.85, 1.2, "Kalan tek buyuk risk", "Ana acik artik algoritmik kalite degil. Esas kalan konu, 350-400 detector seviyesi icin daha uzun sureli operasyonel soak guvencesi.", C.red);
  addPanel(slide8, 6.85, 1.55, 5.8, 4.1);
  slide8.addText("Onerilen aksiyon listesi", {
    x: 7.08,
    y: 1.74,
    w: 2.6,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 12,
    bold: true,
    color: C.text,
    margin: 0,
  });
  addBulletList(
    slide8,
    7.08,
    2.08,
    5.1,
    [
      "8 saat ve uzeri uzun soak kosusunu tamamla",
      "Multi-entity ve rare-event benchmark senaryolarini ekle",
      "Beta yayinda kullanici geri bildirimini topla",
      "Masaustu teslim klasorunu guncel benchmark paketi ile yayina hazir tut",
      "Bu deck'i yonetim sunumu ve teknik demo icin ortak belge olarak kullan",
    ],
    C.muted,
    10
  );
  slide8.addShape(ShapeType.roundRect, {
    x: 7.08,
    y: 4.82,
    w: 5.1,
    h: 0.56,
    rectRadius: 0.08,
    line: { color: C.green, transparency: 100 },
    fill: { color: C.green, transparency: 82 },
  });
  slide8.addText("Tek cumlelik ozet: Final detector bugun benchmarkta guclu, yarin prod'da kalici olmak icin uzun soak bekliyor.", {
    x: 7.28,
    y: 4.98,
    w: 4.72,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.text,
    margin: 0,
    align: "center",
  });
  validateSlide(slide8, pptx);

  await pptx.writeFile({ fileName: OUTPUT_FILE });
  console.log(`Presentation written to ${OUTPUT_FILE}`);
}

buildDeck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
