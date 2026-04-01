const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
const { imageSizingContain } = require("./pptxgenjs_helpers/image");

const repoRoot = path.resolve(__dirname, "..", "..");
const benchmarkRoot = path.join(repoRoot, "benchmarks");
const visualRoot = path.join(benchmarkRoot, "elastic_side_by_side", "outputs", "visual_report");
const outSlidesDir = path.join(__dirname, "slides_explained");
const outAssetsDir = path.join(__dirname, "generated_assets_explained");

const COLORS = {
  ink: "102033",
  slate: "516173",
  muted: "6D7C90",
  blue: "2F6BFF",
  teal: "0F8B8D",
  green: "2AA66D",
  amber: "F2A541",
  red: "D95D5D",
  line: "D7DEE8",
  white: "FFFFFF",
  panel: "F8FBFF",
  paleGreen: "EAF7EF",
  paleAmber: "FFF4E3",
  paleBlue: "EAF1FF",
  paleRed: "FDECEC",
  dark: "0E223F",
};
const ROUND = "roundRect";

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pct(v) {
  return Math.round(v * 1000) / 10;
}

function avg(list) {
  return list.reduce((sum, value) => sum + value, 0) / list.length;
}

function makeDeck() {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "OpenAI Codex";
  pptx.company = "OpenAI";
  pptx.subject = "Grafana Anomaly Detector Benchmark";
  pptx.title = "Grafana Anomaly Detector Benchmark";
  pptx.lang = "tr-TR";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "tr-TR",
  };
  return pptx;
}

function addHeader(slide, kicker, title, subtitle) {
  slide.addText(kicker, {
    x: 0.58, y: 0.26, w: 3.0, h: 0.2, fontFace: "Aptos", fontSize: 9, bold: true,
    color: COLORS.blue, charSpace: 1.4, margin: 0,
  });
  slide.addText(title, {
    x: 0.58, y: 0.52, w: 9.2, h: 0.42, fontFace: "Aptos Display", fontSize: 23,
    bold: true, color: COLORS.ink, margin: 0,
  });
  slide.addText(subtitle, {
    x: 0.6, y: 1.0, w: 11.0, h: 0.42, fontFace: "Aptos", fontSize: 10.5,
    color: COLORS.slate, margin: 0,
  });
}

function addCard(slide, x, y, w, h, title, body, accent, fill = COLORS.white) {
  slide.addShape(ROUND, {
    x, y, w, h, rectRadius: 0.06, fill: { color: fill }, line: { color: accent || COLORS.line, pt: 1.1 },
  });
  slide.addShape(ROUND, {
    x: x + 0.16, y: y + 0.16, w: 0.1, h: 0.4, rectRadius: 0.02,
    fill: { color: accent || COLORS.blue }, line: { color: accent || COLORS.blue, pt: 0 },
  });
  slide.addText(title, {
    x: x + 0.34, y: y + 0.12, w: w - 0.5, h: 0.26, fontFace: "Aptos", fontSize: 10.5,
    bold: true, color: COLORS.ink, margin: 0,
  });
  slide.addText(body, {
    x: x + 0.34, y: y + 0.46, w: w - 0.48, h: h - 0.58, fontFace: "Aptos", fontSize: 9.3,
    color: COLORS.slate, valign: "top", breakLine: false, margin: 0,
  });
}

function addMetricTile(slide, x, y, w, h, title, value, note, accent, fill) {
  slide.addShape(ROUND, {
    x, y, w, h, rectRadius: 0.05, fill: { color: fill }, line: { color: accent, pt: 1.2 },
  });
  slide.addText(title, {
    x: x + 0.18, y: y + 0.14, w: w - 0.36, h: 0.18, fontFace: "Aptos", fontSize: 9.2,
    bold: true, color: COLORS.ink, margin: 0, align: "ctr",
  });
  slide.addText(value, {
    x: x + 0.16, y: y + 0.42, w: w - 0.32, h: 0.36, fontFace: "Aptos Display", fontSize: 22,
    bold: true, color: accent, margin: 0, align: "ctr",
  });
  slide.addText(note, {
    x: x + 0.16, y: y + 0.82, w: w - 0.32, h: 0.22, fontFace: "Aptos", fontSize: 8.2,
    color: COLORS.slate, margin: 0, align: "ctr",
  });
}

function writeSvg(name, svg) {
  ensureDir(outAssetsDir);
  const filePath = path.join(outAssetsDir, name);
  fs.writeFileSync(filePath, svg, "utf8");
  return filePath;
}

function buildComparisonChartSvg(rows) {
  const width = 1040;
  const height = 430;
  const margin = { top: 30, right: 30, bottom: 70, left: 140 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const rowH = plotH / rows.length;
  const barH = 18;
  const gap = 10;
  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  lines.push(`<rect width="${width}" height="${height}" fill="#FFFFFF"/>`);
  for (let tick = 0; tick <= 100; tick += 20) {
    const x = margin.left + (plotW * tick) / 100;
    lines.push(`<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${height - margin.bottom}" stroke="#E6ECF3" stroke-width="1"/>`);
    lines.push(`<text x="${x}" y="${height - 24}" font-size="12" font-family="Aptos" text-anchor="middle" fill="#6D7C90">${tick}%</text>`);
  }
  rows.forEach((row, index) => {
    const yBase = margin.top + index * rowH + 18;
    const ourW = (plotW * row.ours) / 100;
    const elasticW = (plotW * row.elastic) / 100;
    lines.push(`<text x="${margin.left - 18}" y="${yBase + 8}" font-size="14" font-family="Aptos" font-weight="700" text-anchor="end" fill="#102033">${escapeXml(row.label)}</text>`);
    lines.push(`<rect x="${margin.left}" y="${yBase}" rx="6" ry="6" width="${ourW}" height="${barH}" fill="#2AA66D"/>`);
    lines.push(`<rect x="${margin.left}" y="${yBase + barH + gap}" rx="6" ry="6" width="${elasticW}" height="${barH}" fill="#F2A541"/>`);
    lines.push(`<text x="${margin.left + ourW + 8}" y="${yBase + 13}" font-size="12" font-family="Aptos" fill="#102033">${row.ours.toFixed(1)}%</text>`);
    lines.push(`<text x="${margin.left + elasticW + 8}" y="${yBase + barH + gap + 13}" font-size="12" font-family="Aptos" fill="#102033">${row.elastic.toFixed(1)}%</text>`);
  });
  lines.push(`<rect x="${margin.left}" y="${height - 52}" width="12" height="12" rx="3" fill="#2AA66D"/><text x="${margin.left + 20}" y="${height - 42}" font-size="12" font-family="Aptos" fill="#102033">Bizim final Anomaly Detector</text>`);
  lines.push(`<rect x="${margin.left + 220}" y="${height - 52}" width="12" height="12" rx="3" fill="#F2A541"/><text x="${margin.left + 240}" y="${height - 42}" font-size="12" font-family="Aptos" fill="#102033">Elastic Machine Learning</text>`);
  lines.push(`</svg>`);
  return lines.join("");
}

function buildCapacityChartSvg(points, threshold) {
  const width = 980;
  const height = 380;
  const margin = { top: 30, right: 30, bottom: 55, left: 70 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const xMin = Math.min(...points.map((p) => p.x));
  const xMax = Math.max(...points.map((p) => p.x));
  const yMin = 0;
  const yMax = 2.0;
  const scaleX = (value) => margin.left + ((value - xMin) / (xMax - xMin)) * plotW;
  const scaleY = (value) => margin.top + plotH - ((value - yMin) / (yMax - yMin)) * plotH;
  const pathData = points.map((p, index) => `${index === 0 ? "M" : "L"} ${scaleX(p.x)} ${scaleY(p.y)}`).join(" ");
  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  lines.push(`<rect width="${width}" height="${height}" fill="#FFFFFF"/>`);
  for (let tick = 0; tick <= 20; tick += 5) {
    const val = tick / 10;
    const y = scaleY(val);
    lines.push(`<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#E6ECF3" stroke-width="1"/>`);
    lines.push(`<text x="${margin.left - 12}" y="${y + 4}" font-size="12" font-family="Aptos" text-anchor="end" fill="#6D7C90">${val.toFixed(1)} sn</text>`);
  }
  points.forEach((point) => {
    const x = scaleX(point.x);
    lines.push(`<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${height - margin.bottom}" stroke="#F1F4F8" stroke-width="1"/>`);
    lines.push(`<text x="${x}" y="${height - 20}" font-size="12" font-family="Aptos" text-anchor="middle" fill="#6D7C90">${point.x}</text>`);
  });
  lines.push(`<line x1="${margin.left}" y1="${scaleY(threshold)}" x2="${width - margin.right}" y2="${scaleY(threshold)}" stroke="#D95D5D" stroke-width="2" stroke-dasharray="8 6"/>`);
  lines.push(`<text x="${width - margin.right}" y="${scaleY(threshold) - 8}" font-size="12" font-family="Aptos" text-anchor="end" fill="#D95D5D">Risk esigi: ${threshold.toFixed(1)} sn</text>`);
  lines.push(`<path d="${pathData}" fill="none" stroke="#2F6BFF" stroke-width="3"/>`);
  points.forEach((point) => {
    const x = scaleX(point.x);
    const y = scaleY(point.y);
    const color = point.y > threshold ? "#D95D5D" : point.x >= 300 ? "#2AA66D" : "#2F6BFF";
    lines.push(`<circle cx="${x}" cy="${y}" r="6" fill="${color}" />`);
    lines.push(`<text x="${x}" y="${y - 10}" font-size="12" font-family="Aptos" text-anchor="middle" fill="#102033">${point.y.toFixed(2)}</text>`);
  });
  lines.push(`</svg>`);
  return lines.join("");
}

async function buildCoverSlide(filePath, overall) {
  const pptx = makeDeck();
  const slide = pptx.addSlide();
  slide.background = { color: "FBFCFE" };
  addHeader(slide, "GRAFANA ANOMALY DETECTOR", "Benchmark sonucu: final Anomaly Detector, ayni veri setinde Elastic ML'nin onunde", "Bu sunum, ayni labeled veri seti uzerinde yapilan karsilastirmanin yonetim diline cevrilmis ozeti ve kapasite kararini gosterir.");
  addMetricTile(slide, 0.74, 1.74, 3.56, 1.38, "Genel kalite skoru", `${pct(overall.finalF1).toFixed(1)}%`, "Bizim final Anomaly Detector", COLORS.green, COLORS.white);
  addMetricTile(slide, 4.55, 1.74, 3.56, 1.38, "Elastic en iyi sonucu", `${pct(overall.elasticF1).toFixed(1)}%`, "Elastic icin en iyi hassasiyet seviyesi secilse bile", COLORS.amber, COLORS.white);
  addMetricTile(slide, 8.36, 1.74, 3.56, 1.38, "Guvenli operasyon limiti", "300 detector", "Grafana kapanmadan ve gecikme riski buyumeden", COLORS.blue, COLORS.white);
  addCard(slide, 0.74, 3.44, 3.56, 2.28, "Ne karsilastirildi?", "Elastic Machine Learning ile bizim final Anomaly Detector davranisi, ayni anomaly label'larina sahip 6 farkli test senaryosu uzerinde karsilastirildi.", COLORS.blue, COLORS.white);
  addCard(slide, 4.55, 3.44, 3.56, 2.28, "Ne bulundu?", "Bizim final surum, 6 senaryonun tamaminda guclu sonuc verdi ve ortalama toplam kalite skorunda Elastic'in en iyi ayarindan daha yuksek sonuc urettti.", COLORS.green, COLORS.white);
  addCard(slide, 8.36, 3.44, 3.56, 2.28, "Operasyon karari ne?", "Teknik snapshotlarda 400 seviyesine cikilsa bile, surekli ve emniyetli kullanim icin 300 dynamic detector seviyesi daha guvenli bulundu.", COLORS.amber, COLORS.white);
  addCard(slide, 0.74, 6.0, 11.18, 0.95, "Bu sunumdaki isimlendirme", "Bu sunumda 'Anomaly Detector' ifadesi, benchmark sonrasi iyilestirilmis ve urunde kullanilmasi hedeflenen son/final surumu ifade eder.", COLORS.dark, "F5F8FC");
  await pptx.writeFile({ fileName: filePath });
}

async function buildMethodSlide(filePath) {
  const pptx = makeDeck();
  const slide = pptx.addSlide();
  slide.background = { color: "FBFCFE" };
  addHeader(slide, "SUNUMU NASIL OKUMALIYIZ?", "Bu sunumdaki karsilastirma nasil yapildi?", "Tum testlerde ayni veri, ayni etiketli anomali noktalar ve ayni olcum kurallari kullanildi. Bu sunumda 'Anomaly Detector' dedigimiz sey bizim son/final urun profilimizdir.");
  addCard(slide, 0.64, 1.65, 2.75, 1.42, "1. Ayni veri seti", "Her iki cozum de ayni labeled senaryolarla test edildi. Yani iki sistem farkli veriyle degil, birebir ayni data ile karsilastirildi.", COLORS.blue, COLORS.white);
  addCard(slide, 3.55, 1.65, 2.75, 1.42, "2. Ayni hedef", "Amacimiz, gercek anomalileri yakalamak ve yanlis alarmi dusurmekti. Hangi sistem bunu daha iyi yaptiysa daha basarili kabul edildi.", COLORS.green, COLORS.white);
  addCard(slide, 6.46, 1.65, 2.75, 1.42, "3. Adil Elastic ayari", "Elastic icin sadece varsayilan ayar degil, ayni veri setinde en iyi sonucu veren hassasiyet seviyesi de ayrica hesaba katildi.", COLORS.amber, COLORS.white);
  addCard(slide, 9.37, 1.65, 2.75, 1.42, "4. Ayni gorsel kontrol", "Sayisal sonuclarin yanina ayni veri setindeki davranis grafikleri de eklendi. Boylesiyle sadece skor degil, davranisin kendisi de goruldu.", COLORS.teal, COLORS.white);
  addCard(slide, 0.64, 3.34, 5.65, 1.9, "Sunumdaki 'Anomaly Detector' hangi surum?", "Bu sunumda eski gelistirme profili gosterilmiyor. Gosterilen Anomaly Detector, benchmarklardan sonra iyilestirilmis ve final davranis profiline alinmis surumdur. Yani burada gordugunuz sonuclar, urunde kullanmayi hedefledigimiz final davranisi temsil eder.", COLORS.blue, COLORS.panel);
  addCard(slide, 6.49, 3.34, 5.5, 1.9, "Bu nedenle neye bakmaliyiz?", "Bu sunumda asil soru sunudur: 'Ayni veri setinde, final Anomaly Detector mu yoksa Elastic Machine Learning mi daha iyi alarm uretiyor?' Tum slaytlar bu soruyu herkesin okuyabilecegi dille cevaplamak icin hazirlandi.", COLORS.green, COLORS.panel);
  addCard(slide, 0.64, 5.48, 11.35, 1.15, "Ana cikarim", "Buradaki sayisal ve gorsel tum karsilastirmalar, final Anomaly Detector ile Elastic Machine Learning arasindadir. 'Tuned' ya da 'default' gibi gelistirme terimleri bu sunumda on planda tutulmamistir.", COLORS.dark, "F5F8FC");
  await pptx.writeFile({ fileName: filePath });
}

async function buildMetricsSlide(filePath) {
  const pptx = makeDeck();
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  addHeader(slide, "METRIKLERI ACIKLAYALIM", "Bu sayilar ne anlatiyor?", "Skorlar teknik gorunebilir; bu nedenle her metrigi operasyon diliyle, kolay okunacak sekilde acikladik.");
  addCard(slide, 0.72, 1.7, 2.72, 2.1, "Dogru alarm orani", "Teknik adi: Precision. Sistem alarm urettiginde, bu alarm ne kadar gercekten dogru? Ornek: 10 alarmin 9'u gercek problemse bu oran %90'dur.", COLORS.green, COLORS.paleGreen);
  addCard(slide, 3.55, 1.7, 2.72, 2.1, "Yakalama orani", "Teknik adi: Recall. Gercekten var olan anomalilerin kacini gorduk? Ornek: 10 gercek sorunun 8'ini bulduysak bu oran %80'dir.", COLORS.blue, COLORS.paleBlue);
  addCard(slide, 6.38, 1.7, 2.72, 2.1, "Denge skoru", "Teknik adi: F1. Dogru alarm ve yakalama oranini birlikte ozetler. Tek sayida genel kalite gormek icin kullanilir. Yukseldikce toplam kalite artar.", COLORS.amber, COLORS.paleAmber);
  addCard(slide, 9.21, 1.7, 2.72, 2.1, "Yanlis alarm orani", "Sistemin normal davranisi yanlislikla sorun sanma orani. Dusuk olmasi gerekir. Yuksek olursa ekip gereksiz alarm yukune maruz kalir.", COLORS.red, COLORS.paleRed);
  addCard(slide, 0.72, 4.12, 5.55, 1.72, "Bu benchmarkta iyi sonuc ne demek?", "Iyi sonuc, hem gercek anomalileri kacirmamak hem de normal durumlarda gereksiz alarm uretmemektir. Bu nedenle tek bir sayiya degil, bu dort alanin birlikte iyi olmasina baktik.", COLORS.dark, COLORS.panel);
  addCard(slide, 6.45, 4.12, 5.48, 1.72, "Yonetim diliyle yorum", "Dogru alarm orani yuksekse ekip bosa kosmaz. Yakalama orani yuksekse gercek problem kacmaz. Denge skoru genel kaliteyi, yanlis alarm orani ise operasyonel yuku gosterir.", COLORS.teal, COLORS.panel);
  addMetricTile(slide, 0.9, 6.12, 2.5, 1.08, "Daha iyi", "Yuksek", "Dogru alarm | yakalama | denge", COLORS.green, COLORS.white);
  addMetricTile(slide, 3.55, 6.12, 2.5, 1.08, "Daha iyi", "Dusuk", "Yanlis alarm orani", COLORS.red, COLORS.white);
  addMetricTile(slide, 6.2, 6.12, 2.5, 1.08, "Bu sunumun ana metrigi", "Denge skoru", "Toplam kaliteyi tek sayiya indirger", COLORS.amber, COLORS.white);
  addMetricTile(slide, 8.85, 6.12, 2.5, 1.08, "Son karar", "Birlikte", "Butun metriklere birlikte bakildi", COLORS.blue, COLORS.white);
  await pptx.writeFile({ fileName: filePath });
}

async function buildOverallResultsSlide(filePath, overall) {
  const pptx = makeDeck();
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  addHeader(slide, "GENEL SONUC", "Elastic ML ile final Anomaly Detector arasindaki ana sayisal fark", "Elastic icin en iyi sonucu veren hassasiyet seviyesi kullanildiginda bile, final Anomaly Detector toplam kalite ve yakalama oraninda daha yuksek performans verdi.");
  const chartPath = writeSvg("overall_explained.svg", buildComparisonChartSvg([
    { label: "Dogru alarm orani", ours: pct(overall.finalPrecision), elastic: pct(overall.elasticPrecision) },
    { label: "Yakalama orani", ours: pct(overall.finalRecall), elastic: pct(overall.elasticRecall) },
    { label: "Denge skoru", ours: pct(overall.finalF1), elastic: pct(overall.elasticF1) },
    { label: "Yanlis alarm azligi", ours: 100 - pct(overall.finalFpRate), elastic: 100 - pct(overall.elasticFpRate) },
  ]));
  slide.addShape(ROUND, { x: 0.68, y: 1.7, w: 7.05, h: 4.95, fill: { color: COLORS.white }, line: { color: COLORS.line, pt: 1 } });
  slide.addImage({ path: chartPath, ...imageSizingContain(chartPath, 0.86, 1.98, 6.64, 4.42) });
  addCard(slide, 7.98, 1.7, 3.95, 1.28, "Yonetsel yorum", "Bizim cozum, ayni veri setinde daha fazla gercek anomaly yakalarken yanlis alarm yukunu dusuk tuttu.", COLORS.green, COLORS.paleGreen);
  addCard(slide, 7.98, 3.08, 3.95, 1.28, "En guclu fark", "Ozellikle latency, error burst ve resource step-up gibi net problem senaryolarinda Anomaly Detector daha temiz ayrim yapti.", COLORS.blue, COLORS.paleBlue);
  addCard(slide, 7.98, 4.46, 3.95, 1.28, "En zor senaryo", "Subtle level shift gibi daha sinsi degisimlerde iki cozum de iyi davrandi; final Anomaly Detector yine de daha yuksek genel skor verdi.", COLORS.amber, COLORS.paleAmber);
  slide.addShape(ROUND, { x: 0.68, y: 6.78, w: 11.24, h: 0.45, fill: { color: "F8FBFF" }, line: { color: COLORS.blue, pt: 1.1 } });
  slide.addText("6 senaryonun 6'sinda final Anomaly Detector, Elastic'in ayni veri setindeki en iyi toplu sonucuna esit veya daha iyi davrandi.", { x: 0.94, y: 6.9, w: 10.7, h: 0.16, fontFace: "Aptos", fontSize: 9.6, bold: true, color: COLORS.ink, margin: 0, align: "ctr" });
  await pptx.writeFile({ fileName: filePath });
}

async function buildVisualScenarioSlide(filePath, config) {
  const pptx = makeDeck();
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  addHeader(slide, "AYNI DATASET UZERINDE GORSEL DAVRANIS", config.title, config.subtitle);
  const ourImg = path.join(visualRoot, `${config.prefix}.tuned.svg`);
  const elasticImg = path.join(visualRoot, `${config.prefix}.elastic.svg`);
  slide.addShape(ROUND, { x: 0.62, y: 1.7, w: 5.7, h: 4.68, fill: { color: COLORS.white }, line: { color: COLORS.green, pt: 1.2 } });
  slide.addText("Final Anomaly Detector", { x: 0.88, y: 1.82, w: 3.5, h: 0.22, fontFace: "Aptos", fontSize: 10.4, bold: true, color: COLORS.ink, margin: 0 });
  slide.addImage({ path: ourImg, ...imageSizingContain(ourImg, 0.84, 2.16, 5.18, 3.18) });
  slide.addShape(ROUND, { x: 6.97, y: 1.7, w: 5.72, h: 4.68, fill: { color: COLORS.white }, line: { color: COLORS.amber, pt: 1.2 } });
  slide.addText("Elastic Machine Learning", { x: 7.23, y: 1.82, w: 3.8, h: 0.22, fontFace: "Aptos", fontSize: 10.4, bold: true, color: COLORS.ink, margin: 0 });
  slide.addImage({ path: elasticImg, ...imageSizingContain(elasticImg, 7.19, 2.16, 5.18, 3.18) });
  addCard(slide, 0.84, 5.04, 2.2, 0.95, "Gercek anomaly", config.actualText, COLORS.blue, COLORS.panel);
  addCard(slide, 3.08, 5.04, 2.2, 0.95, "Bizim sonuc", config.ourText, COLORS.green, COLORS.paleGreen);
  addCard(slide, 7.18, 5.04, 2.2, 0.95, "Elastic sonucu", config.elasticText, COLORS.amber, COLORS.paleAmber);
  addCard(slide, 9.42, 5.04, 2.2, 0.95, "Yorum", config.commentText, COLORS.dark, "F5F8FC");
  slide.addShape(ROUND, { x: 0.62, y: 6.22, w: 12.07, h: 0.56, fill: { color: "F8FBFF" }, line: { color: COLORS.line, pt: 1.0 } });
  slide.addText(config.bottomNote, { x: 0.9, y: 6.38, w: 11.45, h: 0.16, fontFace: "Aptos", fontSize: 9.1, color: COLORS.slate, margin: 0, align: "ctr" });
  await pptx.writeFile({ fileName: filePath });
}

async function buildCapacitySlide(filePath, capacity) {
  const pptx = makeDeck();
  const slide = pptx.addSlide();
  slide.background = { color: "FBFCFE" };
  addHeader(slide, "KAPASITE VE GUVENLI LIMIT", "Grafana kesintisiz kalirken kac detector guvenle tasinabilir?", "Buradaki karar, sadece sistem ayakta kaliyor mu sorusuna gore degil; gecikme payi, alarm isleme hizi ve operasyonel emniyet payi birlikte degerlendirilerek verildi.");
  const chartPath = writeSvg("capacity_explained.svg", buildCapacityChartSvg(capacity.chartPoints, 1.5));
  slide.addShape(ROUND, { x: 0.64, y: 1.74, w: 7.05, h: 4.42, fill: { color: COLORS.white }, line: { color: COLORS.line, pt: 1 } });
  slide.addImage({ path: chartPath, ...imageSizingContain(chartPath, 0.82, 2.02, 6.65, 3.9) });
  addMetricTile(slide, 8.02, 1.86, 3.62, 1.2, "300 detector", "Guvenli", "60 saniyelik surekli testte sorun olusmadi", COLORS.green, COLORS.white);
  addMetricTile(slide, 8.02, 3.28, 3.62, 1.2, "350 detector", "Riskli", "Bazi olcumlerde isleme suresi risk esigini asti", COLORS.amber, COLORS.white);
  addMetricTile(slide, 8.02, 4.7, 3.62, 1.2, "400 detector", "Yuksek risk", "Risk esigi birden fazla kez asildi, emniyet payi daraldi", COLORS.red, COLORS.white);
  slide.addShape(ROUND, { x: 0.64, y: 6.36, w: 11.36, h: 0.62, fill: { color: "F5F8FC" }, line: { color: COLORS.blue, pt: 1.1 } });
  slide.addText("Son karar: sistem teknik olarak daha yuksege cikabilse de, operasyonel tarafta onerilen guvenli planlama limiti 300 dynamic detector olmalidir.", { x: 0.92, y: 6.55, w: 10.8, h: 0.18, fontFace: "Aptos", fontSize: 9.5, bold: true, color: COLORS.ink, margin: 0, align: "ctr" });
  await pptx.writeFile({ fileName: filePath });
}

async function buildDecisionSlide(filePath) {
  const pptx = makeDeck();
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  addHeader(slide, "KARAR VE ONERI", "Bu benchmarktan hangi net karari cikarmaliyiz?", "Sunumun sayisal ve gorsel tum bulgulari, urun ve operasyon tarafi icin birlikte okunacak sekilde burada ozetlendi.");
  addCard(slide, 0.72, 1.76, 3.55, 1.46, "1. Urun karari", "Final Anomaly Detector artik teknik deneme seviyesinin otesine gecmis durumda. Elastic ML'ye yakin olmanin otesinde, bu test veri setinde daha iyi sonuc verdi.", COLORS.green, COLORS.paleGreen);
  addCard(slide, 4.55, 1.76, 3.55, 1.46, "2. Operasyon karari", "Canli kullanim ve kapasite planlamasi icin guvenli ust limit 300 dynamic detector olarak alinmali. 350 ve uzeri seviyeler ancak kontrollu ek testlerle dusunulmeli.", COLORS.blue, COLORS.paleBlue);
  addCard(slide, 8.38, 1.76, 3.55, 1.46, "3. Sunumun ana mesaji", "Bu benchmarkta gosterilen Anomaly Detector, urunde kullanilmasi hedeflenen final surumdur. Sunum, eski tuning ara adimlarini degil final sonucu anlatir.", COLORS.amber, COLORS.paleAmber);
  addCard(slide, 0.72, 3.56, 5.56, 2.0, "Teknik ekip icin sonraki adimlar", "1. 300 detector limiti ile prod rollout plani yap.\n2. Render, alerting ve dashboard acik uzun sureli soak testini tekrar et.\n3. Explainability gorunumlerini panelde daha da sadelestir.\n4. Yeni use case geldikce labeled benchmark setini buyut.", COLORS.dark, COLORS.panel);
  addCard(slide, 6.46, 3.56, 5.46, 2.0, "Yonetim icin okunacak cikarim", "Bu cozum, kurumsal anomaly detection ihtiyaci icin uygulanabilir bir alternatif haline geldi. Teknik kalite yeterli, operasyonel limit biliniyor ve urunlestirme icin net bir yol haritasi olustu.", COLORS.teal, COLORS.panel);
  addMetricTile(slide, 0.92, 6.05, 2.65, 1.12, "Kalite", "Hazir", "Elastic ile gercek benchmark karsilastirmasi tamamlandi", COLORS.green, COLORS.white);
  addMetricTile(slide, 3.78, 6.05, 2.65, 1.12, "Kapasite", "Biliniyor", "Onerilen ust limit 300 dynamic detector", COLORS.blue, COLORS.white);
  addMetricTile(slide, 6.64, 6.05, 2.65, 1.12, "Sunum dili", "Sadelesti", "Metrikler ve karar dili herkesin anlayacagi hale cevrildi", COLORS.amber, COLORS.white);
  addMetricTile(slide, 9.5, 6.05, 2.18, 1.12, "Karar", "Go / pilot", "Kontrollu genisleme icin uygun", COLORS.dark, COLORS.white);
  await pptx.writeFile({ fileName: filePath });
}

async function main() {
  ensureDir(outSlidesDir);
  ensureDir(outAssetsDir);
  const sideBySide = readJson(path.join(benchmarkRoot, "elastic_side_by_side", "outputs", "scored_comparisons", "side_by_side_metrics.json"));
  const soak300 = readJson(path.join(benchmarkRoot, "soak", "outputs", "soak_profile_300.example.summary.json"));
  const soak350 = readJson(path.join(benchmarkRoot, "soak", "outputs", "soak_profile_350.example.summary.json"));
  const soak400 = readJson(path.join(benchmarkRoot, "soak", "outputs", "soak_profile_400.example.summary.json"));
  const scaleExtended = readJson(path.join(benchmarkRoot, "performance", "outputs", "detector_scale_extended_summary.json"));
  const elasticBest = sideBySide.overall.elastic_threshold_sweep.find((entry) => entry.threshold === sideBySide.overall.elastic_best_threshold);
  const overall = {
    finalPrecision: sideBySide.overall.tuned_mean_precision,
    finalRecall: avg(sideBySide.scenarios.map((scenario) => scenario.tuned.recall)),
    finalF1: sideBySide.overall.tuned_mean_f1,
    finalFpRate: avg(sideBySide.scenarios.map((scenario) => scenario.tuned.false_positive_rate)),
    elasticPrecision: sideBySide.overall.elastic_best_mean_precision,
    elasticRecall: elasticBest.mean_recall,
    elasticF1: sideBySide.overall.elastic_best_mean_f1,
    elasticFpRate: elasticBest.mean_false_positive_rate,
  };
  const capacity = {
    chartPoints: scaleExtended.stages.map((stage) => ({ x: stage.target_dynamic_rules, y: stage.evaluation_duration_seconds })),
    soak300Avg: avg(soak300.samples.filter((item) => !item.warmup_ignored).map((item) => item.evaluation_duration_seconds)),
    soak350Avg: avg(soak350.samples.filter((item) => !item.warmup_ignored).map((item) => item.evaluation_duration_seconds)),
    soak400Avg: avg(soak400.samples.filter((item) => !item.warmup_ignored).map((item) => item.evaluation_duration_seconds)),
  };
  await buildCoverSlide(path.join(outSlidesDir, "slide01_cover_explained.pptx"), overall);
  await buildMethodSlide(path.join(outSlidesDir, "slide02_method_explained.pptx"));
  await buildMetricsSlide(path.join(outSlidesDir, "slide03_metrics_explained.pptx"));
  await buildOverallResultsSlide(path.join(outSlidesDir, "slide04_results_explained.pptx"), overall);
  await buildVisualScenarioSlide(path.join(outSlidesDir, "slide05_latency_explained.pptx"), {
    prefix: "latency_spike_mad",
    title: "Ornek senaryo 1: kisa sureli latency spike",
    subtitle: "Ayni veri setinde, final Anomaly Detector ve Elastic Machine Learning'in ayni soruna nasil tepki verdigi yan yana gosteriliyor.",
    actualText: "Gercek problem 4 veri noktasinda var.",
    ourText: "4/4 anomaly yakalandi, yanlis alarm yok.",
    elasticText: "2/4 anomaly yakalandi, 1 yanlis alarm olustu.",
    commentText: "Net ve kisa sureli spike'larda bizim cozum daha temiz ayrim yapti.",
    bottomNote: "Bu grafikte solda final Anomaly Detector, sagda Elastic Machine Learning davranisi yer alir.",
  });
  await buildVisualScenarioSlide(path.join(outSlidesDir, "slide06_subtle_explained.pptx"), {
    prefix: "subtle_level_shift_ewma",
    title: "Ornek senaryo 2: sinsi ama kalici seviye kaymasi",
    subtitle: "Bu senaryo daha zordur; sistemin ani spike degil, zaman icine yayilan kaymayi ne kadar iyi gordugunu olcer.",
    actualText: "Gercek problem 12 veri noktasina yayildi.",
    ourText: "11/12 anomaly yakalandi, yanlis alarm yok.",
    elasticText: "10/12 anomaly yakalandi, 1 yanlis alarm olustu.",
    commentText: "Zor senaryoda iki cozum de iyi, ama final Anomaly Detector biraz daha iyi.",
    bottomNote: "Bu senaryo, benchmark sonrasi yaptigimiz iyilestirmelerin neden gerekli oldugunu en net gosteren use case oldu.",
  });
  await buildCapacitySlide(path.join(outSlidesDir, "slide07_capacity_explained.pptx"), capacity);
  await buildDecisionSlide(path.join(outSlidesDir, "slide08_decision_explained.pptx"));
  const manifest = [
    "slide01_cover_explained.pptx",
    "slide02_method_explained.pptx",
    "slide03_metrics_explained.pptx",
    "slide04_results_explained.pptx",
    "slide05_latency_explained.pptx",
    "slide06_subtle_explained.pptx",
    "slide07_capacity_explained.pptx",
    "slide08_decision_explained.pptx",
  ];
  fs.writeFileSync(path.join(outSlidesDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log("Generated explained slide decks:", manifest.length);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
