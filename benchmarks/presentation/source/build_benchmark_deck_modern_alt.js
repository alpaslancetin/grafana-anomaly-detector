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
  ellipse: "ellipse",
  line: "line",
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
  "Grafana_Anomaly_Detector_Benchmark_TR_Modern_Alt.pptx"
);

const SHOTS = {
  multi: path.join(SCREENSHOT_DIR, "grafana-multi-metric-premium.png"),
  single: path.join(SCREENSHOT_DIR, "grafana-single-metric-premium.png"),
  latencyDetector: path.join(SCREENSHOT_DIR, "grafana-latency-real.png"),
  latencyElastic: path.join(SCREENSHOT_DIR, "elastic-latency-real.png"),
  shiftDetector: path.join(SCREENSHOT_DIR, "grafana-levelshift-real.png"),
  shiftElastic: path.join(SCREENSHOT_DIR, "elastic-levelshift-real.png"),
};

const C = {
  paper: "F5F1E8",
  paperAlt: "EEE8DC",
  ink: "101828",
  inkSoft: "344054",
  muted: "667085",
  line: "D6CEC0",
  card: "FFFCF7",
  dark: "0C1320",
  darkSoft: "152238",
  darkLine: "28364B",
  white: "FFFFFF",
  orange: "F97316",
  amber: "F59E0B",
  sky: "0EA5E9",
  blue: "2563EB",
  green: "16A34A",
  lime: "84CC16",
  rose: "E11D48",
  mint: "CDEED8",
  powder: "DDEBFA",
  sand: "F2E4D4",
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function addLightBackground(slide, accent = C.orange) {
  slide.background = { color: C.paper };
  slide.addShape(ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    line: { color: C.paper, transparency: 100 },
    fill: { color: C.paper },
  });
  slide.addShape(ShapeType.ellipse, {
    x: -0.6,
    y: -0.45,
    w: 3.3,
    h: 1.7,
    line: { color: accent, transparency: 100 },
    fill: { color: accent, transparency: 85 },
  });
  slide.addShape(ShapeType.ellipse, {
    x: 10.6,
    y: 5.65,
    w: 3.1,
    h: 1.45,
    line: { color: C.sky, transparency: 100 },
    fill: { color: C.sky, transparency: 88 },
  });
  slide.addShape(ShapeType.rect, {
    x: 0.66,
    y: 0.34,
    w: 12.0,
    h: 0.02,
    line: { color: C.line, transparency: 100 },
    fill: { color: C.line },
  });
}

function addDarkBackground(slide) {
  slide.background = { color: C.dark };
  slide.addShape(ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    line: { color: C.dark, transparency: 100 },
    fill: { color: C.dark },
  });
  slide.addShape(ShapeType.ellipse, {
    x: -0.4,
    y: -0.25,
    w: 3.2,
    h: 1.65,
    line: { color: C.orange, transparency: 100 },
    fill: { color: C.orange, transparency: 82 },
  });
  slide.addShape(ShapeType.ellipse, {
    x: 9.85,
    y: 0.1,
    w: 3.5,
    h: 2.4,
    line: { color: C.sky, transparency: 100 },
    fill: { color: C.sky, transparency: 86 },
  });
  slide.addShape(ShapeType.rect, {
    x: 0.66,
    y: 0.34,
    w: 12.0,
    h: 0.02,
    line: { color: C.darkLine, transparency: 100 },
    fill: { color: C.darkLine },
  });
}

function addFooter(slide, slideNo, dark = false) {
  const color = dark ? "A7B2C2" : C.muted;
  slide.addText("Grafana Anomaly Detector | Benchmark alternatif sunum", {
    x: 0.68,
    y: 7.1,
    w: 5.8,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 8,
    color,
    margin: 0,
  });
  slide.addText(String(slideNo), {
    x: 12.18,
    y: 7.06,
    w: 0.42,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 8,
    color,
    bold: true,
    align: "right",
    margin: 0,
  });
}

function addSlideHeader(slide, slideNo, kicker, title, subtitle, opts = {}) {
  const dark = !!opts.dark;
  const accent = opts.accent || (dark ? C.orange : C.orange);
  if (dark) {
    addDarkBackground(slide);
  } else {
    addLightBackground(slide, accent);
  }
  slide.addText(kicker, {
    x: 0.68,
    y: 0.14,
    w: 3.6,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: accent,
    margin: 0,
  });
  slide.addText(title, {
    x: 0.68,
    y: 0.52,
    w: 7.2,
    h: 0.42,
    fontFace: "Aptos Display",
    fontSize: dark ? 24 : 23,
    bold: true,
    color: dark ? C.white : C.ink,
    margin: 0,
  });
  slide.addText(subtitle, {
    x: 0.68,
    y: 0.98,
    w: 7.8,
    h: 0.34,
    fontFace: "Aptos",
    fontSize: 11,
    color: dark ? "C8D1DE" : C.inkSoft,
    margin: 0,
  });
  addFooter(slide, slideNo, dark);
}

function addCard(slide, x, y, w, h, opts = {}) {
  slide.addShape(ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: opts.border || C.line, width: opts.borderWidth || 1 },
    fill: { color: opts.fill || C.card },
    shadow:
      opts.shadow === false
        ? undefined
        : safeOuterShadow("000000", opts.shadowOpacity ?? 0.12, 45, 2, 1),
  });
}

function addDarkCard(slide, x, y, w, h, opts = {}) {
  addCard(slide, x, y, w, h, {
    fill: opts.fill || C.darkSoft,
    border: opts.border || C.darkLine,
    shadowOpacity: opts.shadowOpacity ?? 0.2,
  });
}

function addPill(slide, x, y, w, label, accent, dark = false) {
  slide.addShape(ShapeType.roundRect, {
    x,
    y,
    w,
    h: 0.28,
    rectRadius: 0.08,
    line: { color: accent, transparency: 100 },
    fill: { color: accent, transparency: dark ? 74 : 82 },
  });
  slide.addText(label, {
    x,
    y: y + 0.04,
    w,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 8,
    bold: true,
    color: dark ? C.white : C.ink,
    align: "center",
    margin: 0,
  });
}

function addStat(slide, x, y, w, label, value, note, accent, dark = false) {
  const fill = dark ? C.darkSoft : C.card;
  const border = dark ? C.darkLine : C.line;
  const primary = dark ? C.white : C.ink;
  const secondary = dark ? "C7D0DD" : C.muted;
  addCard(slide, x, y, w, 1.05, {
    fill,
    border,
    shadowOpacity: dark ? 0.22 : 0.1,
  });
  slide.addText(label, {
    x: x + 0.18,
    y: y + 0.14,
    w: w - 0.36,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 8,
    bold: true,
    color: secondary,
    margin: 0,
  });
  slide.addText(value, {
    x: x + 0.18,
    y: y + 0.36,
    w: w - 0.36,
    h: 0.24,
    fontFace: "Aptos Display",
    fontSize: 18,
    bold: true,
    color: accent,
    margin: 0,
  });
  slide.addText(note, {
    x: x + 0.18,
    y: y + 0.72,
    w: w - 0.36,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 8,
    color: secondary,
    margin: 0,
  });
}

function addParagraph(slide, x, y, w, h, text, color, size = 10) {
  slide.addText(text, {
    x,
    y,
    w,
    h,
    fontFace: "Aptos",
    fontSize: size,
    color,
    margin: 0,
    valign: "top",
  });
}

function addBulletList(slide, x, y, w, items, color, fontSize = 10) {
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
    h: Math.max(0.4, items.length * 0.26),
    fontFace: "Aptos",
    fontSize,
    color,
    margin: 0,
    breakLine: false,
    valign: "top",
  });
}

function addMetricCard(slide, x, y, w, title, body, accent) {
  addCard(slide, x, y, w, 1.18, { fill: C.card, border: C.line, shadowOpacity: 0.08 });
  slide.addShape(ShapeType.rect, {
    x: x + 0.16,
    y: y + 0.16,
    w: 0.08,
    h: 0.84,
    line: { color: accent, transparency: 100 },
    fill: { color: accent },
  });
  slide.addText(title, {
    x: x + 0.34,
    y: y + 0.16,
    w: w - 0.5,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.ink,
    margin: 0,
  });
  addParagraph(slide, x + 0.34, y + 0.42, w - 0.5, 0.5, body, C.inkSoft, 9);
}

function addScenarioSlide(slide, cfg) {
  const { tag, accent, leftImage, rightImage, leftScore, rightScore, note, title, subtitle } = cfg;
  addSlideHeader(slide, cfg.slideNo, "GERCEK EKRAN KARSILASTIRMASI", title, subtitle, {
    dark: false,
    accent,
  });
  addPill(slide, 0.68, 1.45, 1.75, tag, accent, false);

  addCard(slide, 0.68, 1.88, 5.82, 3.72, { fill: C.card, border: C.line, shadowOpacity: 0.12 });
  slide.addText("Grafana Anomaly Detector", {
    x: 0.92,
    y: 2.08,
    w: 2.8,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 12,
    bold: true,
    color: C.ink,
    margin: 0,
  });
  slide.addText(leftScore, {
    x: 4.98,
    y: 2.08,
    w: 1.18,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.green,
    align: "right",
    margin: 0,
  });
  slide.addImage({
    path: leftImage,
    ...imageSizingContain(leftImage, 0.92, 2.42, 5.34, 2.92),
  });

  addCard(slide, 6.83, 1.88, 5.82, 3.72, { fill: C.card, border: C.line, shadowOpacity: 0.12 });
  slide.addText("Elastic ML", {
    x: 7.08,
    y: 2.08,
    w: 1.8,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 12,
    bold: true,
    color: C.ink,
    margin: 0,
  });
  slide.addText(rightScore, {
    x: 11.1,
    y: 2.08,
    w: 1.3,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.amber,
    align: "right",
    margin: 0,
  });
  slide.addImage({
    path: rightImage,
    ...imageSizingContain(rightImage, 7.08, 2.42, 5.34, 2.92),
  });

  addMetricCard(
    slide,
    0.68,
    5.92,
    3.9,
    "Ne goruluyor?",
    note.seen,
    accent
  );
  addMetricCard(
    slide,
    4.73,
    5.92,
    3.9,
    "Neden onemli?",
    note.why,
    C.sky
  );
  addMetricCard(
    slide,
    8.78,
    5.92,
    3.87,
    "Kisa yorum",
    note.summary,
    C.orange
  );
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
  pptx.subject = "Grafana Anomaly Detector modern alternative benchmark presentation";
  pptx.title = "Grafana Anomaly Detector Benchmark Modern Alternative";
  pptx.lang = "tr-TR";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "tr-TR",
  };

  const slide1 = pptx.addSlide();
  addSlideHeader(
    slide1,
    1,
    "ALTERNATIF SUNUM",
    "Grafana Anomaly Detector",
    "Mevcut benchmark hikayesinin daha cagdas, daha sakin ve ust yonetim odakli tasarlanmis alternatif sunumu.",
    { dark: true, accent: C.orange }
  );
  slide1.addText("Elastic ML ile ayni labeled dataset uzerindeki benchmark sonuclarinin modern tasarimli ozet gorunumu", {
    x: 0.68,
    y: 1.58,
    w: 5.6,
    h: 0.42,
    fontFace: "Aptos",
    fontSize: 15,
    bold: true,
    color: C.white,
    margin: 0,
  });
  addParagraph(
    slide1,
    0.68,
    2.16,
    4.95,
    1.0,
    "Bu alternatif deck, mevcut benchmark sonuclarini degistirmez. Ayni veri, ayni sayisal sonuc ve ayni gorsel kanit korunur; yalnizca sunum dili daha editoryal ve daha sakin hale getirilir.",
    "CBD5E1",
    10
  );
  addStat(slide1, 0.68, 5.52, 1.75, "Final detector", "6 / 6", "Benchmark senaryosu", C.green, true);
  addStat(slide1, 2.6, 5.52, 1.75, "Mean F1", "1.00", "Final runtime sonucu", C.green, true);
  addStat(slide1, 4.52, 5.52, 1.95, "Elastic best F1", "0.71", "Ayni veri, en iyi threshold", C.amber, true);
  addDarkCard(slide1, 6.85, 1.34, 5.78, 5.95);
  slide1.addImage({
    path: SHOTS.multi,
    ...imageSizingCrop(SHOTS.multi, 7.02, 1.5, 5.44, 5.61),
  });
  addPill(slide1, 9.05, 1.56, 1.95, "GERCEK GRAFANA EKRANI", C.orange, true);
  validateSlide(slide1, pptx);

  const slide2 = pptx.addSlide();
  addSlideHeader(
    slide2,
    2,
    "NE OLCULDU?",
    "Karsilastirma cercevesi",
    "Bu benchmark'in gucu, veri farkini degil detector davranisini olcuyor olmasindan gelir.",
    { dark: false, accent: C.sky }
  );
  slide2.addText("01", {
    x: 0.68,
    y: 1.56,
    w: 0.9,
    h: 0.6,
    fontFace: "Aptos Display",
    fontSize: 34,
    bold: true,
    color: C.orange,
    margin: 0,
  });
  slide2.addText("Ayni labeled dataset", {
    x: 1.58,
    y: 1.66,
    w: 2.6,
    h: 0.22,
    fontFace: "Aptos",
    fontSize: 12,
    bold: true,
    color: C.ink,
    margin: 0,
  });
  addParagraph(
    slide2,
    1.58,
    1.94,
    2.6,
    0.58,
    "Latency spike, error burst, traffic drop, seasonal spike, resource step-up ve subtle level shift ayni etiketlerle iki tarafa da verildi.",
    C.inkSoft,
    9
  );
  slide2.addText("02", {
    x: 4.52,
    y: 1.56,
    w: 0.9,
    h: 0.6,
    fontFace: "Aptos Display",
    fontSize: 34,
    bold: true,
    color: C.sky,
    margin: 0,
  });
  slide2.addText("Gercek Elastic runtime", {
    x: 5.42,
    y: 1.66,
    w: 2.7,
    h: 0.22,
    fontFace: "Aptos",
    fontSize: 12,
    bold: true,
    color: C.ink,
    margin: 0,
  });
  addParagraph(
    slide2,
    5.42,
    1.94,
    2.7,
    0.58,
    "Elastic tarafi local trial runtime ile kosuldu; record export alinip threshold sweep yapildi ve en iyi sonuc ayrica raporlandi.",
    C.inkSoft,
    9
  );
  slide2.addText("03", {
    x: 8.46,
    y: 1.56,
    w: 0.9,
    h: 0.6,
    fontFace: "Aptos Display",
    fontSize: 34,
    bold: true,
    color: C.green,
    margin: 0,
  });
  slide2.addText("Final Grafana runtime", {
    x: 9.36,
    y: 1.66,
    w: 2.7,
    h: 0.22,
    fontFace: "Aptos",
    fontSize: 12,
    bold: true,
    color: C.ink,
    margin: 0,
  });
  addParagraph(
    slide2,
    9.36,
    1.94,
    2.65,
    0.58,
    "Grafana plugin ve exporter son runtime ayarlariyla tekrar kosuldu; gorsel davranis ve precision/recall/F1 ayni raporda birlestirildi.",
    C.inkSoft,
    9
  );
  addCard(slide2, 0.68, 3.0, 12.0, 2.95, { fill: C.card, border: C.line, shadowOpacity: 0.1 });
  slide2.addText("Bu benchmark neden daha anlamli?", {
    x: 0.95,
    y: 3.22,
    w: 3.2,
    h: 0.22,
    fontFace: "Aptos",
    fontSize: 14,
    bold: true,
    color: C.ink,
    margin: 0,
  });
  addBulletList(
    slide2,
    0.98,
    3.62,
    5.3,
    [
      "Iki tarafa da ayni zaman serisi ve ayni anomaly etiketleri verildi.",
      "Karsilastirma dataset degil, detector davranisi uzerinden yapildi.",
      "Sayisal kalite ve gorsel davranis ayni benchmark paketinde toplandi.",
    ],
    C.inkSoft,
    10
  );
  addCard(slide2, 6.6, 3.42, 5.52, 2.15, { fill: C.paperAlt, border: C.line, shadow: false });
  slide2.addText("Kisa karar dili", {
    x: 6.88,
    y: 3.66,
    w: 2.2,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.ink,
    margin: 0,
  });
  addParagraph(
    slide2,
    6.88,
    3.98,
    4.7,
    0.98,
    "Bu nedenle eldeki sonuc 'iki urun farkli veriyle bakildi' gibi zayif bir kiyas degil. Ayni veri setinde iki yaklasimin nasil davrandigini goren dogrudan bir benchmark paketi.",
    C.inkSoft,
    10
  );
  validateSlide(slide2, pptx);

  const slide3 = pptx.addSlide();
  addScenarioSlide(slide3, {
    slideNo: 3,
    tag: "LATENCY SPIKE",
    accent: C.orange,
    leftImage: SHOTS.latencyDetector,
    rightImage: SHOTS.latencyElastic,
    leftScore: "F1 1.00",
    rightScore: "F1 0.57",
    title: "Ayni veri uzerinde davranis farki",
    subtitle: "Bu slayttaki iki ekran da gercek urun arayuzlerinden alinmis orijinal screenshot'lardir.",
    note: {
      seen: "Grafana paneli burst'u tek olay gibi daha temiz ayiriyor ve beklenen banttan kopusu daha net okutturuyor.",
      why: "Operasyonda farkin onemi, alarm geldiginde olay penceresinin daha stabil ve daha az parca parca gorulmesi.",
      summary: "Bu senaryoda final detector hem gorsel olarak daha okunur hem de sayisal olarak daha yuksek kalite veriyor.",
    },
  });
  validateSlide(slide3, pptx);

  const slide4 = pptx.addSlide();
  addScenarioSlide(slide4, {
    slideNo: 4,
    tag: "LEVEL SHIFT",
    accent: C.sky,
    leftImage: SHOTS.shiftDetector,
    rightImage: SHOTS.shiftElastic,
    leftScore: "F1 1.00",
    rightScore: "F1 0.87",
    title: "Kalici seviye kaymasi nasil okunuyor?",
    subtitle: "Subtle level shift, benchmark ailesindeki en kritik iyilestirme alanlarindan biriydi; final surum bu senaryo icin ozel olarak guclendirildi.",
    note: {
      seen: "Grafana detector baseline kirilmasini daha tutarli izliyor; Elastic ayni pencereyi goruyor ama daha parca parca isaretleme yapiyor.",
      why: "Kalici seviye kaymasi gibi zor anomalilerde okunabilirlik ve olay butunlugu, kullanim guvenini dogrudan etkiliyor.",
      summary: "Bu senaryoda iki taraf da problemi goruyor; fakat final detector daha tutarli ve toplam kalite skoru daha yuksek.",
    },
  });
  validateSlide(slide4, pptx);

  const slide5 = pptx.addSlide();
  addSlideHeader(
    slide5,
    5,
    "SAYISAL OZET",
    "Sayilarin acik Turkce ile okunusu",
    "Teknik olmayan ekipler icin metriklerin ne anlattigi ayni slaytta kisa olarak aciklanir.",
    { dark: false, accent: C.orange }
  );
  slide5.addChart(
    ChartType.bar,
    [
      { name: "Grafana final", labels: ["Dogruluk", "Yakalama gucu", "Genel denge"], values: [1.0, 1.0, 1.0] },
      { name: "Elastic best", labels: ["Dogruluk", "Yakalama gucu", "Genel denge"], values: [0.8043, 0.6496, 0.7067] },
    ],
    {
      x: 0.72,
      y: 1.62,
      w: 6.15,
      h: 4.35,
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
      gridLine: { color: "DDD6CA", width: 1 },
      chartColors: [C.green, C.amber],
      gapWidth: 90,
      showBorder: false,
    }
  );
  addMetricCard(slide5, 7.28, 1.75, 5.12, "Dogruluk", "Alarm geldiginde bunun gercekten problem olma ihtimali. Daha yuksek olmasi daha az bos alarm demek.", C.green);
  addMetricCard(slide5, 7.28, 3.12, 5.12, "Yakalama gucu", "Gercek problemleri kacirmama gucu. Daha yuksek olmasi daha az gozden kacirma demek.", C.sky);
  addMetricCard(slide5, 7.28, 4.49, 5.12, "Genel denge skoru", "Dogruluk ve yakalama gucunu tek sayida toplayan genel kalite gostergesi. Teknik ekipler F1 diye bilir.", C.orange);
  addCard(slide5, 0.72, 6.25, 12.0, 0.56, { fill: C.card, border: C.line, shadow: false });
  slide5.addText("Senaryo sonucu", {
    x: 0.95,
    y: 6.43,
    w: 1.2,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 9,
    bold: true,
    color: C.ink,
    margin: 0,
  });
  const chips = [
    { label: "Latency spike", accent: C.orange },
    { label: "Error burst", accent: C.orange },
    { label: "Traffic drop", accent: C.orange },
    { label: "Seasonal hourly spike", accent: C.sky },
    { label: "Resource step-up", accent: C.orange },
    { label: "Subtle level shift", accent: C.orange },
  ];
  chips.forEach((chip, index) => {
    const x = 2.08 + index * 1.72;
    slide5.addShape(ShapeType.roundRect, {
      x,
      y: 6.34,
      w: 1.48,
      h: 0.32,
      rectRadius: 0.08,
      line: { color: chip.accent, transparency: 100 },
      fill: { color: chip.accent, transparency: 84 },
    });
    slide5.addText(chip.label, {
      x: x + 0.06,
      y: 6.44,
      w: 1.36,
      h: 0.1,
      fontFace: "Aptos",
      fontSize: 7,
      bold: true,
      color: C.ink,
      align: "center",
      margin: 0,
    });
  });
  validateSlide(slide5, pptx);

  const slide6 = pptx.addSlide();
  addSlideHeader(
    slide6,
    6,
    "KAPASITE GORUNUMU",
    "Kisa soak testinde gozlenen band",
    "Bu slayt sadece bugun olculen davranisi anlatir; nihai prod ceiling iddiasi yapmaz.",
    { dark: true, accent: C.sky }
  );
  slide6.addChart(
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
      y: 1.58,
      w: 6.4,
      h: 4.8,
      catAxisLabelFontFace: "Aptos",
      catAxisLabelFontSize: 10,
      valAxisLabelFontFace: "Aptos",
      valAxisLabelFontSize: 9,
      valAxisMinVal: 0,
      valAxisMaxVal: 1.4,
      valAxisNumFmt: "0.0",
      showLegend: false,
      gridLine: { color: C.darkLine, width: 1 },
      chartColors: [C.sky],
      lineSize: 2.5,
      showMarker: true,
      markerSize: 7,
      showBorder: false,
    }
  );
  addStat(slide6, 7.52, 1.72, 1.56, "300 detector", "PASS", "Kisa soak", C.green, true);
  addStat(slide6, 9.24, 1.72, 1.56, "350 detector", "PASS", "Kisa soak", C.green, true);
  addStat(slide6, 10.96, 1.72, 1.56, "400 detector", "PASS", "Kisa soak", C.amber, true);
  addDarkCard(slide6, 7.52, 3.15, 5.0, 1.2);
  slide6.addText("Ne biliyoruz?", {
    x: 7.76,
    y: 3.34,
    w: 1.7,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 11,
    bold: true,
    color: C.white,
    margin: 0,
  });
  addParagraph(
    slide6,
    7.76,
    3.64,
    4.4,
    0.5,
    "Dashboard, render ve alert-ready query acikken 300, 350 ve 400 detector seviyeleri kisa soak penceresinde temiz gecti.",
    "C8D1DE",
    9
  );
  addDarkCard(slide6, 7.52, 4.58, 5.0, 1.2);
  slide6.addText("Ne soylemiyoruz?", {
    x: 7.76,
    y: 4.78,
    w: 1.9,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 11,
    bold: true,
    color: C.white,
    margin: 0,
  });
  addParagraph(
    slide6,
    7.76,
    5.08,
    4.4,
    0.5,
    "Bu sonuc tek basina kalici prod ceiling anlamina gelmez. 8 saat ve uzeri uzun soak testi halen gerekli.",
    "C8D1DE",
    9
  );
  addDarkCard(slide6, 7.52, 6.01, 5.0, 0.7, { fill: "1B2D49", border: C.sky, shadowOpacity: 0.18 });
  slide6.addText("Bugun icin pratik planlama bandi: 350-400 detector", {
    x: 7.78,
    y: 6.24,
    w: 4.46,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: C.white,
    margin: 0,
    align: "center",
  });
  validateSlide(slide6, pptx);

  const slide7 = pptx.addSlide();
  addSlideHeader(
    slide7,
    7,
    "BUGUN NE SOYLENEBILIR?",
    "Karar cercevesi",
    "Son slayt, eldeki benchmark paketinin neyi kanitladigini ve neyin halen acik kaldigini ayristirir.",
    { dark: false, accent: C.orange }
  );
  addCard(slide7, 0.72, 1.56, 5.85, 4.92, { fill: C.card, border: C.line, shadowOpacity: 0.08 });
  slide7.addText("Olculmus ve gosterilmis durum", {
    x: 0.98,
    y: 1.84,
    w: 2.8,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 13,
    bold: true,
    color: C.ink,
    margin: 0,
  });
  addBulletList(
    slide7,
    0.98,
    2.22,
    5.1,
    [
      "Final detector ayni dataset uzerinde Elastic ML trial runtime'inin onunde bir genel kalite skoru uretiyor.",
      "Gorsel karsilastirma ekranlari gercek Grafana ve gercek Elastic arayuzlerinden alindi.",
      "Premium chart iyilestirmeleri benchmark sonrasinda urune alinmis durumda.",
      "300, 350 ve 400 detector seviyesi kisa soak penceresinde temiz gorundu.",
    ],
    C.inkSoft,
    10
  );
  addCard(slide7, 6.74, 1.56, 5.85, 4.92, { fill: C.paperAlt, border: C.line, shadowOpacity: 0.04 });
  slide7.addText("Halen acik kalan basliklar", {
    x: 7.0,
    y: 1.84,
    w: 2.9,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 13,
    bold: true,
    color: C.ink,
    margin: 0,
  });
  addBulletList(
    slide7,
    7.0,
    2.22,
    5.1,
    [
      "Uzun sureli soak henuz tamamlanmis degil; kalici ceiling icin ayrica kosulmali.",
      "Rare-event ve multi-entity benchmark ailesi buyutulebilir.",
      "Beta kullanimindan gelecek operasyonel geri bildirim, sonraki tuning turu icin hala degerli.",
    ],
    C.inkSoft,
    10
  );
  addCard(slide7, 0.72, 6.66, 11.87, 0.42, { fill: C.ink, border: C.ink, shadow: false });
  slide7.addText(
    "Tek cumlelik ozet: Bu benchmark paketi bugun guclu bir kalite ve okunabilirlik resmi veriyor; kalici operasyon limiti icin ise uzun soak adimi siradaki en dogru is.",
    {
      x: 0.98,
      y: 6.8,
      w: 11.3,
      h: 0.14,
      fontFace: "Aptos",
      fontSize: 9,
      bold: true,
      color: C.white,
      margin: 0,
      align: "center",
    }
  );
  validateSlide(slide7, pptx);

  await pptx.writeFile({ fileName: OUTPUT_FILE });
  console.log(`Presentation written to ${OUTPUT_FILE}`);
}

buildDeck().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
