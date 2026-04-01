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
  line: "line",
  ellipse: "ellipse",
};

const ChartType = pptxgen.ChartType || {
  line: "line",
};

const ROOT = path.resolve(__dirname, "..");
const SCREENSHOT_DIR = path.join(ROOT, "assets", "screenshots");
const OUTPUT_DIR = path.join(ROOT, "output");
const OUTPUT_FILE = path.join(
  OUTPUT_DIR,
  "Grafana_Anomaly_Detector_Benchmark_TR_Reference_Theme_Alt.pptx"
);

const SHOTS = {
  multi: path.join(SCREENSHOT_DIR, "grafana-multi-metric-premium.png"),
  latencyDetector: path.join(SCREENSHOT_DIR, "grafana-latency-real.png"),
  latencyElastic: path.join(SCREENSHOT_DIR, "elastic-latency-real.png"),
  shiftDetector: path.join(SCREENSHOT_DIR, "grafana-levelshift-real.png"),
  shiftElastic: path.join(SCREENSHOT_DIR, "elastic-levelshift-real.png"),
  latencyDetectorCrop: path.join(SCREENSHOT_DIR, "latency-detector-crop.png"),
  latencyElasticCrop: path.join(SCREENSHOT_DIR, "latency-elastic-crop.png"),
  shiftDetectorCrop: path.join(SCREENSHOT_DIR, "shift-detector-crop.png"),
  shiftElasticCrop: path.join(SCREENSHOT_DIR, "shift-elastic-crop.png"),
};

const C = {
  bg: "15181F",
  bgAlt: "1A1F27",
  panel: "242A33",
  panelAlt: "20262F",
  border: "515B69",
  text: "F7F4EE",
  muted: "C9CDD5",
  soft: "A9B0BC",
  green: "66CC5A",
  orange: "F29C38",
  blue: "76B5D8",
  red: "E3624F",
  white: "FFFFFF",
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function addBackground(slide) {
  slide.background = { color: C.bg };
  slide.addShape(ShapeType.roundRect, {
    x: 0.22,
    y: 0.18,
    w: 12.84,
    h: 6.94,
    rectRadius: 0.12,
    line: { color: C.border, width: 1.2 },
    fill: { color: C.bg, transparency: 0 },
  });
  slide.addShape(ShapeType.ellipse, {
    x: -0.5,
    y: -0.1,
    w: 3.4,
    h: 1.6,
    line: { color: C.bg, transparency: 100 },
    fill: { color: C.panel, transparency: 54 },
  });
  slide.addShape(ShapeType.ellipse, {
    x: 10.2,
    y: 5.45,
    w: 3.2,
    h: 1.7,
    line: { color: C.bg, transparency: 100 },
    fill: { color: C.panel, transparency: 62 },
  });
}

function addFooter(slide, no) {
  slide.addText("Grafana Anomaly Detector | Benchmark alternatif tema", {
    x: 0.55,
    y: 7.03,
    w: 4.8,
    h: 0.14,
    fontFace: "Aptos",
    fontSize: 8,
    color: C.soft,
    margin: 0,
  });
  slide.addText(String(no), {
    x: 12.45,
    y: 7.01,
    w: 0.25,
    h: 0.14,
    fontFace: "Aptos",
    fontSize: 8,
    color: C.soft,
    align: "right",
    margin: 0,
  });
}

function addTitle(slide, title, subtitle) {
  slide.addText(title, {
    x: 0.68,
    y: 0.58,
    w: 8.7,
    h: 1.45,
    fontFace: "Aptos Display",
    fontSize: 30,
    bold: true,
    color: C.text,
    margin: 0,
    breakLine: true,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.7,
      y: 2.1,
      w: 7.8,
      h: 0.7,
      fontFace: "Aptos",
      fontSize: 15,
      color: C.muted,
      margin: 0,
      breakLine: true,
    });
  }
}

function addPanel(slide, x, y, w, h, opts = {}) {
  slide.addShape(ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: opts.border || C.border, width: opts.borderWidth || 1.1 },
    fill: { color: opts.fill || C.panel },
    shadow:
      opts.shadow === false
        ? undefined
        : safeOuterShadow("000000", opts.shadowOpacity ?? 0.18, 45, 2, 1),
  });
}

function addStatCard(slide, x, y, w, h, title, value, note, accent) {
  addPanel(slide, x, y, w, h, { fill: C.panelAlt });
  slide.addText(title, {
    x: x + 0.18,
    y: y + 0.18,
    w: w - 0.36,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 10,
    color: C.text,
    align: "center",
    margin: 0,
  });
  slide.addText(value, {
    x: x + 0.18,
    y: y + 0.72,
    w: w - 0.36,
    h: 0.6,
    fontFace: "Aptos Display",
    fontSize: 36,
    bold: true,
    color: accent,
    align: "center",
    margin: 0,
  });
  slide.addText(note, {
    x: x + 0.24,
    y: y + h - 0.78,
    w: w - 0.48,
    h: 0.5,
    fontFace: "Aptos",
    fontSize: 9,
    color: C.muted,
    align: "center",
    margin: 0,
  });
}

function addFlowCard(slide, x, y, w, h, title, body) {
  addPanel(slide, x, y, w, h, { fill: "20262F" });
  slide.addText(title, {
    x: x + 0.18,
    y: y + 0.5,
    w: w - 0.36,
    h: 0.3,
    fontFace: "Aptos",
    fontSize: 12,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide.addText(body, {
    x: x + 0.18,
    y: y + 0.88,
    w: w - 0.36,
    h: h - 1.02,
    fontFace: "Aptos",
    fontSize: 9,
    color: C.muted,
    margin: 0,
    breakLine: true,
  });
}

function addCompareRow(slide, y, scoreColor, score, note, imagePath, imageLabel, borderColor) {
  addPanel(slide, 0.82, y, 4.9, 1.6, { fill: C.bgAlt, border: borderColor });
  slide.addShape(ShapeType.roundRect, {
    x: 0.92,
    y: y + 0.14,
    w: 1.55,
    h: 0.34,
    rectRadius: 0.03,
    line: { color: borderColor, transparency: 100 },
    fill: { color: borderColor, transparency: 8 },
  });
  slide.addText(score, {
    x: 1.0,
    y: y + 0.2,
    w: 1.38,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.white,
    margin: 0,
    align: "center",
  });
  slide.addText(note, {
    x: 1.0,
    y: y + 0.56,
    w: 4.4,
    h: 0.84,
    fontFace: "Aptos",
    fontSize: 10,
    color: C.text,
    margin: 0,
    breakLine: true,
  });
  slide.addText("→", {
    x: 5.75,
    y: y + 0.56,
    w: 0.46,
    h: 0.3,
    fontFace: "Aptos Display",
    fontSize: 24,
    bold: true,
    color: borderColor,
    margin: 0,
    align: "center",
  });
  addPanel(slide, 6.42, y, 5.15, 1.6, { fill: C.bgAlt, border: borderColor });
  slide.addImage({
    path: imagePath,
    ...imageSizingContain(imagePath, 6.58, y + 0.14, 4.82, 1.2),
  });
  slide.addText(imageLabel, {
    x: 6.72,
    y: y + 1.34,
    w: 4.56,
    h: 0.14,
    fontFace: "Aptos",
    fontSize: 8,
    color: C.text,
    align: "center",
    margin: 0,
  });
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
  pptx.subject = "Grafana Anomaly Detector reference-theme benchmark deck";
  pptx.title = "Grafana Anomaly Detector Benchmark Reference Theme";
  pptx.lang = "tr-TR";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "tr-TR",
  };

  const slide1 = pptx.addSlide();
  addBackground(slide1);
  addTitle(
    slide1,
    "Grafana Anomaly Detector:\nBenchmark Sonuclarinin Alternatif Sunumu",
    "Referans deck'in gorsel standardini koruyan; daha sakin, daha net ve gercek Grafana / Elastic ekranlariyla ilerleyen alternatif akis."
  );
  addPanel(slide1, 7.05, 3.06, 5.28, 2.78, { fill: C.bgAlt, border: C.border });
  slide1.addImage({
    path: SHOTS.multi,
    ...imageSizingCrop(SHOTS.multi, 7.2, 3.18, 4.98, 2.46),
  });
  slide1.addShape(ShapeType.roundRect, {
    x: 0.74,
    y: 6.14,
    w: 3.4,
    h: 0.42,
    rectRadius: 0.05,
    line: { color: C.border, width: 1 },
    fill: { color: C.bgAlt },
  });
  slide1.addText("Gercek dataset ve gercek ekran karsilastirmalari", {
    x: 0.9,
    y: 6.26,
    w: 3.05,
    h: 0.14,
    fontFace: "Aptos",
    fontSize: 11,
    color: C.text,
    margin: 0,
    align: "center",
  });
  addFooter(slide1, 1);
  validateSlide(slide1, pptx);

  const slide2 = pptx.addSlide();
  addBackground(slide2);
  addStatCard(slide2, 0.45, 0.75, 5.98, 2.75, "Fonksiyonel kalite", "6 / 6", "Labeled benchmark senaryolari final detector tarafinda eksiksiz yakalandi.", C.green);
  addStatCard(slide2, 6.9, 0.75, 5.98, 2.75, "Ortalama F1 skoru", "1.00 vs 0.71", "Ayni veri setinde final detector ve Elastic best-threshold sonucu.", C.orange);
  addStatCard(slide2, 0.45, 3.95, 5.98, 2.75, "Kapasite testi", "400 PASS", "Kisa soak penceresinde dashboard, render ve alert query birlikte temiz gecti.", C.green);
  addStatCard(slide2, 6.9, 3.95, 5.98, 2.75, "Urun durumu", "HAZIR", "Gercek karsilastirma, guncel chart deneyimi ve benchmark paketi tamamlandi.", C.green);
  addFooter(slide2, 2);
  validateSlide(slide2, pptx);

  const slide3 = pptx.addSlide();
  addBackground(slide3);
  slide3.addText("Grafana tarafi: operasyonel okunabilirlik", {
    x: 0.5,
    y: 0.48,
    w: 6.9,
    h: 0.4,
    fontFace: "Aptos Display",
    fontSize: 24,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide3.addText("Premium chart gorseli, incident timeline ve anomaly inspector birlikte okunur.", {
    x: 0.5,
    y: 1.0,
    w: 7.4,
    h: 0.22,
    fontFace: "Aptos",
    fontSize: 13,
    color: C.muted,
    margin: 0,
  });
  addPanel(slide3, 0.72, 1.45, 8.95, 4.68, { fill: C.bgAlt });
  slide3.addImage({
    path: SHOTS.multi,
    ...imageSizingContain(SHOTS.multi, 0.92, 1.63, 8.55, 4.28),
  });
  addPanel(slide3, 10.0, 1.55, 2.42, 1.15, { fill: C.panelAlt, border: C.orange });
  slide3.addText("Incident timeline", {
    x: 10.18,
    y: 1.73,
    w: 1.95,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide3.addText("Anomali olaylarini tek tek noktalar degil, gruplanmis incident akisi olarak okutur.", {
    x: 10.18,
    y: 2.04,
    w: 1.95,
    h: 0.42,
    fontFace: "Aptos",
    fontSize: 8,
    color: C.muted,
    margin: 0,
  });
  addPanel(slide3, 10.0, 3.0, 2.42, 1.15, { fill: C.panelAlt, border: C.orange });
  slide3.addText("Daha net chart", {
    x: 10.18,
    y: 3.18,
    w: 1.95,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide3.addText("Crosshair, focus band ve belirgin anomaly isaretleri sayesinde takip hizlaniyor.", {
    x: 10.18,
    y: 3.49,
    w: 1.95,
    h: 0.42,
    fontFace: "Aptos",
    fontSize: 8,
    color: C.muted,
    margin: 0,
  });
  addPanel(slide3, 10.0, 4.45, 2.42, 1.15, { fill: C.panelAlt, border: C.orange });
  slide3.addText("Anomaly inspector", {
    x: 10.18,
    y: 4.63,
    w: 1.95,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide3.addText("Expected, current, confidence ve reason ayni panelde toplanarak karari seffaflastiriyor.", {
    x: 10.18,
    y: 4.94,
    w: 1.95,
    h: 0.42,
    fontFace: "Aptos",
    fontSize: 8,
    color: C.muted,
    margin: 0,
  });
  addFooter(slide3, 3);
  validateSlide(slide3, pptx);

  const slide4 = pptx.addSlide();
  addBackground(slide4);
  slide4.addText("Karsilastirma metodolojisi", {
    x: 0.5,
    y: 0.56,
    w: 6.6,
    h: 0.32,
    fontFace: "Aptos Display",
    fontSize: 24,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide4.addText("Ayni veri, ayni etiket, ayni kiyas mantigi.", {
    x: 0.5,
    y: 1.0,
    w: 5.2,
    h: 0.22,
    fontFace: "Aptos",
    fontSize: 14,
    color: C.muted,
    margin: 0,
  });
  addFlowCard(slide4, 0.5, 2.0, 2.58, 2.58, "1. Labeled dataset", "Latency spike, error burst, traffic drop, seasonal spike ve level shift senaryolari ayni etiketlerle hazirlandi.");
  addFlowCard(slide4, 3.58, 2.0, 2.58, 2.58, "2. Grafana detector", "Plugin ve exporter son runtime ayarlariyla kosuldu; precision, recall ve F1 olculdu.");
  addFlowCard(slide4, 6.66, 2.0, 2.58, 2.58, "3. Elastic ML", "Ayni veri local Elastic trial runtime'a yuklendi; gercek ML job export'u ve threshold sweep alindi.");
  addFlowCard(slide4, 9.74, 2.0, 2.58, 2.58, "4. Birlestirme", "Sayisal skorlar ve gorsel davranis ayni benchmark paketinde yan yana toplandi.");
  ["3.13","6.21","9.29"].forEach((x) => {
    slide4.addText("→", {
      x: Number(x),
      y: 3.0,
      w: 0.28,
      h: 0.24,
      fontFace: "Aptos Display",
      fontSize: 22,
      bold: true,
      color: C.green,
      margin: 0,
      align: "center",
    });
  });
  addFooter(slide4, 4);
  validateSlide(slide4, pptx);

  const slide5 = pptx.addSlide();
  addBackground(slide5);
  slide5.addText("Gorsel kiyas I: Latency spike", {
    x: 1.8,
    y: 0.52,
    w: 9.1,
    h: 0.34,
    fontFace: "Aptos Display",
    fontSize: 22,
    bold: true,
    color: C.text,
    margin: 0,
    align: "center",
  });
  addCompareRow(
    slide5,
    1.45,
    C.green,
    "F1 1.00 | Grafana Anomaly Detector",
    "Ayni anomaly penceresini tek olay gibi daha toplu gosteriyor. Beklenen bandtan kopus daha net okunuyor.",
    SHOTS.latencyDetectorCrop,
    "focused graph view | grafana detector",
    C.green
  );
  addCompareRow(
    slide5,
    3.72,
    C.orange,
    "F1 0.57 | Elastic ML",
    "Ayni bolgeyi tespit ediyor ancak threshold secimine daha bagimli ve olay davranisi daha parcali gorunuyor.",
    SHOTS.latencyElasticCrop,
    "focused graph view | elastic ml",
    C.orange
  );
  addFooter(slide5, 5);
  validateSlide(slide5, pptx);

  const slide6 = pptx.addSlide();
  addBackground(slide6);
  slide6.addText("Gorsel kiyas II: Level shift", {
    x: 1.85,
    y: 0.52,
    w: 9.0,
    h: 0.34,
    fontFace: "Aptos Display",
    fontSize: 22,
    bold: true,
    color: C.text,
    margin: 0,
    align: "center",
  });
  addCompareRow(
    slide6,
    1.45,
    C.green,
    "F1 1.00 | Grafana Anomaly Detector",
    "Kalici seviye kaymasini daha tutarli izliyor; baseline kirilmasi tek pencere icinde daha duzenli okunuyor.",
    SHOTS.shiftDetectorCrop,
    "focused graph view | grafana detector",
    C.green
  );
  addCompareRow(
    slide6,
    3.72,
    C.orange,
    "F1 0.87 | Elastic ML",
    "Ayni pencereyi goruyor ancak isaretleme daha parcali kaliyor. Toplam kalite skoru yine de referans olarak degerli.",
    SHOTS.shiftElasticCrop,
    "focused graph view | elastic ml",
    C.orange
  );
  addFooter(slide6, 6);
  validateSlide(slide6, pptx);

  const slide7 = pptx.addSlide();
  addBackground(slide7);
  slide7.addText("Kapasite gorunumu", {
    x: 0.6,
    y: 0.52,
    w: 4.4,
    h: 0.32,
    fontFace: "Aptos Display",
    fontSize: 24,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide7.addText("Kisa soak penceresinde gozlenen band; nihai prod ceiling iddiasi degil.", {
    x: 0.6,
    y: 0.98,
    w: 6.3,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 12,
    color: C.muted,
    margin: 0,
  });
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
      x: 0.72,
      y: 1.52,
      w: 6.3,
      h: 4.7,
      catAxisLabelFontFace: "Aptos",
      catAxisLabelFontSize: 10,
      valAxisLabelFontFace: "Aptos",
      valAxisLabelFontSize: 9,
      valAxisMinVal: 0,
      valAxisMaxVal: 1.4,
      valAxisNumFmt: "0.0",
      showLegend: false,
      gridLine: { color: C.border, width: 1 },
      chartColors: [C.blue],
      lineSize: 2.2,
      showMarker: true,
      markerSize: 6,
      showBorder: false,
    }
  );
  addStatCard(slide7, 7.52, 1.55, 1.66, 1.08, "300 detector", "PASS", "Kisa soak", C.green);
  addStatCard(slide7, 9.34, 1.55, 1.66, 1.08, "350 detector", "PASS", "Kisa soak", C.green);
  addStatCard(slide7, 11.16, 1.55, 1.66, 1.08, "400 detector", "PASS", "Kisa soak", C.orange);
  addPanel(slide7, 7.52, 3.1, 5.28, 1.1, { fill: C.panelAlt });
  slide7.addText("Ne soyluyor?", {
    x: 7.76,
    y: 3.32,
    w: 1.5,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide7.addText("300, 350 ve 400 detector seviyesi kisa soak penceresinde dashboard + render + alert query ile temiz gorundu.", {
    x: 7.76,
    y: 3.62,
    w: 4.7,
    h: 0.42,
    fontFace: "Aptos",
    fontSize: 9,
    color: C.muted,
    margin: 0,
  });
  addPanel(slide7, 7.52, 4.48, 5.28, 1.1, { fill: C.panelAlt });
  slide7.addText("Ne acik kaliyor?", {
    x: 7.76,
    y: 4.7,
    w: 1.8,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.text,
    margin: 0,
  });
  slide7.addText("Kalici operasyon limiti icin 8 saat ve uzeri uzun soak testi halen gerekli.", {
    x: 7.76,
    y: 5.0,
    w: 4.7,
    h: 0.42,
    fontFace: "Aptos",
    fontSize: 9,
    color: C.muted,
    margin: 0,
  });
  addFooter(slide7, 7);
  validateSlide(slide7, pptx);

  await pptx.writeFile({ fileName: OUTPUT_FILE });
  console.log(`Presentation written to ${OUTPUT_FILE}`);
}

buildDeck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
