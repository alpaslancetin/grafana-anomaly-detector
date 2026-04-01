const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
const pptxEnums = new PptxGenJS();
const SHAPE = pptxEnums.ShapeType;
const CHART = pptxEnums.ChartType;
const { imageSizingContain } = require("./pptxgenjs_helpers/image");
const { safeOuterShadow } = require("./pptxgenjs_helpers/util");
const { svgToDataUri } = require("./pptxgenjs_helpers/svg");
const {
  warnIfSlideHasOverlaps,
  warnIfSlideElementsOutOfBounds,
} = require("./pptxgenjs_helpers/layout");

const repoRoot = path.resolve(__dirname, "..", "..");
const benchmarkRoot = path.join(repoRoot, "benchmarks");
const desktopBenchmarkRoot = "C:\\Users\\alpas\\Desktop\\Grafana_upgrade\\anomaly_detector\\benchmark";

const paths = {
  functionalSummary: path.join(
    benchmarkRoot,
    "functional",
    "outputs",
    "functional_benchmark_summary.json"
  ),
  tuningSummary: path.join(
    benchmarkRoot,
    "functional",
    "outputs",
    "functional_tuning_sweep_summary.json"
  ),
  sideBySideMetrics: path.join(
    benchmarkRoot,
    "elastic_side_by_side",
    "outputs",
    "scored_comparisons",
    "side_by_side_metrics.json"
  ),
  performanceSummary: path.join(
    benchmarkRoot,
    "performance",
    "outputs",
    "detector_scale_extended_summary.json"
  ),
  soak300: path.join(
    benchmarkRoot,
    "soak",
    "outputs",
    "soak_profile_300.example.summary.json"
  ),
  soak350: path.join(
    benchmarkRoot,
    "soak",
    "outputs",
    "soak_profile_350.example.summary.json"
  ),
  soak400: path.join(
    benchmarkRoot,
    "soak",
    "outputs",
    "soak_profile_400.example.summary.json"
  ),
  visuals: path.join(
    benchmarkRoot,
    "elastic_side_by_side",
    "outputs",
    "visual_report"
  ),
};

const palette = {
  ink: "122033",
  slate: "526277",
  muted: "6D7B90",
  line: "D7DEE8",
  surface: "F5F8FC",
  surface2: "EAF1F8",
  white: "FFFFFF",
  navy: "0E223F",
  teal: "0F8B8D",
  emerald: "2AA66D",
  amber: "F2A541",
  rose: "D95D5D",
  blue: "3E7BFA",
  lime: "A5C956",
};

const generatedAssetsDir = path.join(__dirname, "generated_assets");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function pct(value) {
  return Math.round(value * 1000) / 10;
}

function formatPct(value) {
  return `${pct(value).toFixed(1)}%`;
}

function formatSeconds(value) {
  return `${value.toFixed(2)}s`;
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function writeSvgAsset(fileName, svg) {
  ensureDir(generatedAssetsDir);
  const outPath = path.join(generatedAssetsDir, fileName);
  fs.writeFileSync(outPath, svg, "utf8");
  return outPath;
}

function metricCellFill(percent) {
  if (percent >= 95) return "E7F6EE";
  if (percent >= 85) return "EAF2FF";
  if (percent >= 70) return "FFF2DE";
  return "FCE6E6";
}

function metricCellText(percent) {
  if (percent >= 95) return palette.emerald;
  if (percent >= 85) return palette.blue;
  if (percent >= 70) return palette.amber;
  return palette.rose;
}

function buildGroupedBarSvg({ categories, series, colors, yMax = 100, yStep = 20 }) {
  const width = 980;
  const height = 560;
  const margin = { top: 30, right: 24, bottom: 72, left: 72 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const groupW = plotW / categories.length;
  const barW = Math.min(32, (groupW * 0.68) / series.length);
  const innerGap = 8;
  const lines = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );
  lines.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  for (let tick = 0; tick <= yMax; tick += yStep) {
    const y = margin.top + plotH - (tick / yMax) * plotH;
    lines.push(`<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#E2E8F0" stroke-width="1"/>`);
    lines.push(`<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-family="Arial" font-size="12" fill="#64748B">${tick}</text>`);
  }

  categories.forEach((category, catIndex) => {
    const groupX = margin.left + catIndex * groupW;
    const barsTotalW = series.length * barW + (series.length - 1) * innerGap;
    const startX = groupX + (groupW - barsTotalW) / 2;
    series.forEach((serie, serieIndex) => {
      const value = serie.values[catIndex];
      const barH = (value / yMax) * plotH;
      const x = startX + serieIndex * (barW + innerGap);
      const y = margin.top + plotH - barH;
      lines.push(`<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" ry="4" fill="#${colors[serieIndex]}"/>`);
      lines.push(`<text x="${x + barW / 2}" y="${y - 8}" text-anchor="middle" font-family="Arial" font-size="12" font-weight="700" fill="#243446">${value.toFixed(1)}</text>`);
    });
    lines.push(`<text x="${groupX + groupW / 2}" y="${height - 24}" text-anchor="middle" font-family="Arial" font-size="12" fill="#475569">${escapeXml(category)}</text>`);
  });

  lines.push(`<line x1="${margin.left}" y1="${margin.top + plotH}" x2="${width - margin.right}" y2="${margin.top + plotH}" stroke="#CBD5E1" stroke-width="1.2"/>`);

  let legendX = margin.left;
  const legendY = height - 50;
  series.forEach((serie, idx) => {
    lines.push(`<rect x="${legendX}" y="${legendY}" width="14" height="14" rx="3" fill="#${colors[idx]}"/>`);
    lines.push(`<text x="${legendX + 22}" y="${legendY + 12}" font-family="Arial" font-size="12" fill="#243446">${escapeXml(serie.name)}</text>`);
    legendX += 150;
  });

  lines.push(`</svg>`);
  return lines.join("");
}

function buildLineChartSvg({
  labels,
  series,
  colors,
  yMax = 100,
  yStep = 20,
  yTickFormatter = (value) => String(value),
  pointFormatter = (value) => value.toFixed(1),
}) {
  const width = 980;
  const height = 560;
  const margin = { top: 30, right: 24, bottom: 72, left: 72 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const xStep = labels.length > 1 ? plotW / (labels.length - 1) : plotW;
  const lines = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );
  lines.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);

  for (let tick = 0; tick <= yMax; tick += yStep) {
    const y = margin.top + plotH - (tick / yMax) * plotH;
    lines.push(`<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#E2E8F0" stroke-width="1"/>`);
    lines.push(`<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-family="Arial" font-size="12" fill="#64748B">${escapeXml(yTickFormatter(tick))}</text>`);
  }

  labels.forEach((label, idx) => {
    const x = margin.left + idx * xStep;
    lines.push(`<line x1="${x}" y1="${margin.top}" x2="${x}" y2="${margin.top + plotH}" stroke="#F1F5F9" stroke-width="1"/>`);
    lines.push(`<text x="${x}" y="${height - 24}" text-anchor="middle" font-family="Arial" font-size="12" fill="#475569">${escapeXml(label)}</text>`);
  });

  series.forEach((serie, serieIndex) => {
    const pts = serie.values.map((value, idx) => {
      const x = margin.left + idx * xStep;
      const y = margin.top + plotH - (value / yMax) * plotH;
      return { x, y, value };
    });
    lines.push(`<polyline fill="none" stroke="#${colors[serieIndex]}" stroke-width="3" points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}"/>`);
    pts.forEach((p) => {
      lines.push(`<circle cx="${p.x}" cy="${p.y}" r="4.5" fill="#${colors[serieIndex]}"/>`);
      lines.push(`<text x="${p.x}" y="${p.y - 9}" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="#243446">${escapeXml(pointFormatter(p.value))}</text>`);
    });
  });

  lines.push(`<line x1="${margin.left}" y1="${margin.top + plotH}" x2="${width - margin.right}" y2="${margin.top + plotH}" stroke="#CBD5E1" stroke-width="1.2"/>`);

  let legendX = margin.left;
  const legendY = height - 50;
  series.forEach((serie, idx) => {
    lines.push(`<line x1="${legendX}" y1="${legendY + 7}" x2="${legendX + 16}" y2="${legendY + 7}" stroke="#${colors[idx]}" stroke-width="3"/>`);
    lines.push(`<circle cx="${legendX + 8}" cy="${legendY + 7}" r="4" fill="#${colors[idx]}"/>`);
    lines.push(`<text x="${legendX + 24}" y="${legendY + 12}" font-family="Arial" font-size="12" fill="#243446">${escapeXml(serie.name)}</text>`);
    legendX += 170;
  });

  lines.push(`</svg>`);
  return lines.join("");
}

function labelize(name) {
  const map = {
    latency_spike_mad: "Latency spike",
    error_burst_mad: "Error burst",
    traffic_drop_ewma: "Traffic drop",
    seasonal_hourly_spike: "Seasonal spike",
    resource_step_ewma: "Resource step-up",
    subtle_level_shift_ewma: "Subtle shift",
  };
  return map[name] || name;
}

function scenarioVisualPath(name, variant) {
  return path.join(paths.visuals, `${name}.${variant}.svg`);
}

function addHeader(slide, section, title, subtitle, options = {}) {
  const dark = options.dark ?? false;
  slide.addText(section.toUpperCase(), {
    x: 0.58,
    y: 0.28,
    w: 2.6,
    h: 0.18,
    fontFace: "Aptos",
    fontSize: 9,
    bold: true,
    color: dark ? "A9D8FF" : palette.blue,
    charSpace: 1.5,
  });
  slide.addText(title, {
    x: 0.58,
    y: 0.54,
    w: options.titleWidth || 8.6,
    h: 0.42,
    fontFace: "Aptos Display",
    fontSize: options.titleSize || 23,
    bold: true,
    color: dark ? palette.white : palette.ink,
    margin: 0,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.6,
      y: 1.02,
      w: options.subtitleWidth || 8.7,
      h: 0.38,
      fontFace: "Aptos",
      fontSize: 10.5,
      color: dark ? "D7E7FA" : palette.slate,
      margin: 0,
      breakLine: false,
    });
  }
}

function addFooter(slide, index) {
  slide.addText(`Benchmark deck | ${index}`, {
    x: 12.35,
    y: 7.1,
    w: 0.5,
    h: 0.18,
    align: "right",
    fontFace: "Aptos",
    fontSize: 8,
    color: "8EA0B8",
    margin: 0,
  });
}

function addStatCard(slide, x, y, w, h, accent, value, label, note, dark = false) {
  slide.addShape(SHAPE.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.12,
    fill: { color: dark ? "143258" : palette.white },
    line: { color: dark ? "224A7A" : palette.line, pt: 1 },
    shadow: safeOuterShadow("172434", 0.16, 45, 2, 1),
  });
  slide.addShape(SHAPE.roundRect, {
    x: x + 0.18,
    y: y + 0.18,
    w: 0.12,
    h: h - 0.36,
    rectRadius: 0.04,
    fill: { color: accent },
    line: { color: accent, pt: 0 },
  });
  slide.addText(value, {
    x: x + 0.42,
    y: y + 0.24,
    w: w - 0.55,
    h: 0.46,
    fontFace: "Aptos Display",
    fontSize: 22,
    bold: true,
    color: dark ? palette.white : palette.ink,
    margin: 0,
  });
  slide.addText(label, {
    x: x + 0.42,
    y: y + 0.76,
    w: w - 0.55,
    h: 0.28,
    fontFace: "Aptos",
    fontSize: 10.5,
    bold: true,
    color: dark ? "E3EEFA" : palette.slate,
    margin: 0,
  });
  slide.addText(note, {
    x: x + 0.42,
    y: y + 1.1,
    w: w - 0.55,
    h: h - 1.22,
    fontFace: "Aptos",
    fontSize: 9,
    color: dark ? "B6C9E4" : palette.muted,
    margin: 0,
    valign: "mid",
  });
}

function addBulletList(slide, items, x, y, w, opts = {}) {
  slide.addText(items.map((item) => `- ${item}`).join("\n"), {
    x,
    y,
    w,
    h: opts.h || 2.4,
    fontFace: "Aptos",
    fontSize: opts.fontSize || 11,
    color: opts.color || palette.ink,
    margin: 0,
    paraSpaceAfterPt: 8,
    valign: "top",
  });
}

function addCallout(slide, x, y, w, h, title, body, accent) {
  slide.addShape(SHAPE.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.12,
    fill: { color: "F8FBFF" },
    line: { color: accent, pt: 1.2 },
  });
  slide.addText(title, {
    x: x + 0.2,
    y: y + 0.18,
    w: w - 0.36,
    h: 0.28,
    fontFace: "Aptos",
    fontSize: 11,
    bold: true,
    color: palette.ink,
    margin: 0,
  });
  slide.addText(body, {
    x: x + 0.2,
    y: y + 0.52,
    w: w - 0.36,
    h: h - 0.68,
    fontFace: "Aptos",
    fontSize: 9.5,
    color: palette.slate,
    margin: 0,
  });
}

function addVisualComparison(slide, scenarioName, title, subtitle, footerNote) {
  addHeader(slide, "Visual Benchmark", title, subtitle);
  const boxes = [
    { x: 0.58, label: "Bizim detector | Default", variant: "default", accent: palette.teal },
    { x: 4.52, label: "Bizim detector | Tuned", variant: "tuned", accent: palette.emerald },
    { x: 8.46, label: "Elastic ML | Real export", variant: "elastic", accent: palette.amber },
  ];

  boxes.forEach((box) => {
    slide.addShape(SHAPE.roundRect, {
      x: box.x,
      y: 1.63,
      w: 3.72,
      h: 4.64,
      rectRadius: 0.08,
      fill: { color: palette.white },
      line: { color: palette.line, pt: 1 },
      shadow: safeOuterShadow("172434", 0.1, 45, 2, 1),
    });
    slide.addShape(SHAPE.roundRect, {
      x: box.x + 0.16,
      y: 1.79,
      w: 0.1,
      h: 0.42,
      rectRadius: 0.03,
      fill: { color: box.accent },
      line: { color: box.accent, pt: 0 },
    });
    slide.addText(box.label, {
      x: box.x + 0.34,
      y: 1.78,
      w: 2.95,
      h: 0.24,
      fontFace: "Aptos",
      fontSize: 10.2,
      bold: true,
      color: palette.ink,
      margin: 0,
    });
    const imagePath = scenarioVisualPath(scenarioName, box.variant);
    slide.addImage({
      path: imagePath,
      ...imageSizingContain(imagePath, box.x + 0.18, 2.15, 3.36, 3.48),
    });
  });

  addCallout(
    slide,
    0.58,
    6.46,
    11.65,
    0.46,
    "Gorsel yorum",
    footerNote,
    palette.blue
  );
}

function validateSlide(slide, pptx) {
  warnIfSlideHasOverlaps(slide, pptx, {
    muteContainment: true,
    ignoreDecorativeShapes: true,
  });
  warnIfSlideElementsOutOfBounds(slide, pptx);
}

async function main() {
  const functional = readJson(paths.functionalSummary);
  const tuning = readJson(paths.tuningSummary);
  const sideBySide = readJson(paths.sideBySideMetrics);
  const performance = readJson(paths.performanceSummary);
  const soak300 = readJson(paths.soak300);
  const soak350 = readJson(paths.soak350);
  const soak400 = readJson(paths.soak400);
  const elasticStandardSweep = sideBySide.overall.elastic_threshold_sweep.find(
    (item) => item.threshold === sideBySide.overall.elastic_standard_threshold
  );
  const elasticBestSweep = sideBySide.overall.elastic_threshold_sweep.find(
    (item) => item.threshold === sideBySide.overall.elastic_best_threshold
  );
  const standardRecall = elasticStandardSweep.mean_recall;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "OpenAI Codex";
  pptx.company = "Turkcell";
  pptx.subject = "Grafana Anomaly Detector Benchmark";
  pptx.title = "Grafana Anomaly Detector Benchmark 2026";
  pptx.lang = "tr-TR";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "tr-TR",
  };
  pptx.defineLayout({ name: "WIDE", width: 13.333, height: 7.5 });

  // Slide 1
  let slide = pptx.addSlide();
  slide.background = { color: palette.navy };
  slide.addShape(SHAPE.ellipse, {
    x: 10.4,
    y: 0.38,
    w: 2.45,
    h: 2.35,
    line: { color: "1D4E80", pt: 3 },
    fill: { color: palette.navy, transparency: 100 },
    rotate: 22,
  });
  slide.addShape(SHAPE.ellipse, {
    x: 10.85,
    y: 4.92,
    w: 1.85,
    h: 1.65,
    line: { color: "275F9C", pt: 2.2 },
    fill: { color: palette.navy, transparency: 100 },
  });
  slide.addText("GRAFANA ANOMALY DETECTOR", {
    x: 0.62,
    y: 0.46,
    w: 4.6,
    h: 0.26,
    fontFace: "Aptos",
    fontSize: 10,
    bold: true,
    color: "9FD2FF",
    charSpace: 2.2,
    margin: 0,
  });
  slide.addText("Benchmark Sonuclari\nve Elastic Side-by-Side Degerlendirmesi", {
    x: 0.58,
    y: 0.92,
    w: 7.35,
    h: 1.55,
    fontFace: "Aptos Display",
    fontSize: 26,
    bold: true,
    color: palette.white,
    margin: 0,
  });
  slide.addText(
    "Ayni labeled dataset uzerinde fonksiyonel kalite, Elastic ML davranisi, tuning etkisi ve operasyonel kapasite limiti.",
    {
      x: 0.6,
      y: 2.54,
      w: 6.65,
      h: 0.58,
      fontFace: "Aptos",
      fontSize: 11.5,
      color: "D7E7FA",
      margin: 0,
    }
  );
  addStatCard(
    slide,
    0.62,
    4.08,
    2.88,
    1.55,
    palette.emerald,
    formatPct(tuning.overall.tuned_mean_f1),
    "Bizim tuned mean F1",
    "Ayni benchmark suite icinde erisilen en iyi kalite."
  );
  addStatCard(
    slide,
    3.67,
    4.08,
    2.88,
    1.55,
    palette.amber,
    formatPct(sideBySide.overall.elastic_best_mean_f1),
    "Elastic best mean F1",
    "Threshold sweep sonrasi Elastic icin bulunan en iyi seviye."
  );
  addStatCard(
    slide,
    6.72,
    4.08,
    2.88,
    1.55,
    palette.teal,
    `${functional.overall.scenario_count}`,
    "Labeled benchmark senaryosu",
    "Latency, error, traffic, seasonal, resource ve subtle shift use case'leri."
  );
  addStatCard(
    slide,
    9.77,
    4.08,
    2.88,
    1.55,
    palette.blue,
    "300",
    "Guvenli dynamic detector limiti",
    "Kisa soak sonucuna gore onerilen operasyonel tavan."
  );
  slide.addShape(SHAPE.roundRect, {
    x: 8.02,
    y: 0.92,
    w: 4.48,
    h: 2.38,
    rectRadius: 0.12,
    fill: { color: "16345C" },
    line: { color: "29527F", pt: 1 },
  });
  slide.addText("Ana karar", {
    x: 8.28,
    y: 1.18,
    w: 1.5,
    h: 0.24,
    fontFace: "Aptos",
    fontSize: 10.5,
    bold: true,
    color: "A9D8FF",
    margin: 0,
  });
  slide.addText(
    "Bu benchmark turunda tuned detector, ayni dataset uzerinde Elastic ML trial kosusundan daha iyi performans verdi. Default profil ise 6 use case'in 5'inde hedef kaliteyi koruyor.",
    {
      x: 8.28,
      y: 1.52,
      w: 3.86,
      h: 1.08,
      fontFace: "Aptos",
      fontSize: 12.3,
      bold: true,
      color: palette.white,
      margin: 0,
    }
  );
  slide.addText("Sunum tarihi: 28 Mart 2026", {
    x: 8.28,
    y: 2.74,
    w: 2.4,
    h: 0.22,
    fontFace: "Aptos",
    fontSize: 9,
    color: "BDD2EA",
    margin: 0,
  });
  addFooter(slide, 1);
  validateSlide(slide, pptx);

  // Slide 2
  slide = pptx.addSlide();
  slide.background = { color: "FBFCFE" };
  addHeader(
    slide,
    "Benchmark Scope",
    "Benchmark nasil kurgulandi?",
    "Hem urun davranisi hem de kapasite limiti ayni benchmark paketi icinde olculdu."
  );
  const pipeline = [
    "Labeled synthetic scenarios",
    "Current detector defaults",
    "Tuned detector profile",
    "Real Elastic ML records",
    "Metrics + visual report",
  ];
  pipeline.forEach((step, idx) => {
    const x = 0.62 + idx * 2.48;
    slide.addShape(SHAPE.roundRect, {
      x,
      y: 2.0,
      w: 2.04,
      h: 0.88,
      rectRadius: 0.1,
      fill: { color: idx % 2 === 0 ? "F1F7FE" : "EDF5F1" },
      line: { color: idx % 2 === 0 ? "BFD5F7" : "B6DFC9", pt: 1 },
    });
    slide.addText(step, {
      x: x + 0.14,
      y: 2.21,
      w: 1.76,
      h: 0.36,
      fontFace: "Aptos",
      fontSize: 10.4,
      bold: true,
      color: palette.ink,
      align: "ctr",
      margin: 0,
    });
    if (idx < pipeline.length - 1) {
      slide.addShape(SHAPE.chevron, {
        x: x + 2.09,
        y: 2.22,
        w: 0.32,
        h: 0.28,
        fill: { color: "AFC0D9" },
        line: { color: "AFC0D9", pt: 0 },
      });
    }
  });
  addCallout(
    slide,
    0.62,
    3.28,
    4.15,
    2.6,
    "Test edilen 6 ana use case",
    "Latency spike, error burst, traffic drop, seasonal hourly spike, resource step-up ve subtle sustained level shift.",
    palette.blue
  );
  slide.addText(
    "- Latency spike\n- Error burst\n- Traffic drop\n- Seasonal hourly spike\n- Resource step-up\n- Subtle sustained level shift",
    {
      x: 0.88,
      y: 3.82,
      w: 3.6,
      h: 1.8,
      fontFace: "Aptos",
      fontSize: 10.2,
      color: palette.ink,
      margin: 0,
    }
  );
  addCallout(
    slide,
    5.08,
    3.28,
    3.55,
    2.6,
    "Elastic'ten alinip urune uygulanan iyilestirmeler",
    "Seasonal fallback, window-context scoring, score driver gorunurlugu ve benchmark tabanli preset kalibrasyonu.",
    palette.emerald
  );
  addBulletList(
    slide,
    [
      "Seasonal tarafta weekday_hour -> hour_of_day fallback eklendi.",
      "EWMA akisina multi-bucket benzeri window score eklendi.",
      "Panel detayinda point score, window score ve primary driver gosterilmeye baslandi.",
      "Use-case bazli tuned profil setleri cikarildi.",
    ],
    5.3,
    3.82,
    3.08,
    { h: 1.76, fontSize: 9.8, color: palette.ink }
  );
  addCallout(
    slide,
    8.94,
    3.28,
    3.77,
    2.6,
    "Kapasite testi mantigi",
    "Tek nokta scale + 60 saniyelik soak birlestirilerek teknik limit ile guvenli operasyon limiti ayrildi.",
    palette.amber
  );
  addBulletList(
    slide,
    [
      "Scale testi 75 -> 400 detector araligini taradi.",
      "Soak profilleri 300 / 350 / 400 seviyelerinde kostu.",
      "Karar metriği evaluation duration + scrape success + alert sorgu yaniti oldu.",
    ],
    9.16,
    3.82,
    3.22,
    { h: 1.76, fontSize: 9.8, color: palette.ink }
  );
  addFooter(slide, 2);
  validateSlide(slide, pptx);

  const overallQualitySvgPath = writeSvgAsset(
    "overall_quality.svg",
    buildGroupedBarSvg({
      categories: ["Precision", "Recall", "F1"],
      series: [
        {
          name: "Bizim default",
          values: [
            pct(functional.overall.mean_precision),
            pct(functional.overall.mean_recall),
            pct(functional.overall.mean_f1),
          ],
        },
        {
          name: "Bizim tuned",
          values: [
            pct(tuning.overall.tuned_mean_precision),
            pct(tuning.overall.tuned_mean_recall),
            pct(tuning.overall.tuned_mean_f1),
          ],
        },
        {
          name: "Elastic best",
          values: [
            pct(sideBySide.overall.elastic_best_mean_precision),
            pct(elasticBestSweep.mean_recall),
            pct(sideBySide.overall.elastic_best_mean_f1),
          ],
        },
        {
          name: "Elastic standard",
          values: [
            pct(sideBySide.overall.elastic_standard_mean_precision),
            pct(elasticStandardSweep.mean_recall),
            pct(sideBySide.overall.elastic_standard_mean_f1),
          ],
        },
      ],
      colors: [palette.teal, palette.emerald, palette.amber, palette.rose],
    })
  );

  const elasticSweepSvgPath = writeSvgAsset(
    "elastic_threshold_sweep.svg",
    buildLineChartSvg({
      labels: sideBySide.overall.elastic_threshold_sweep.map((t) => String(t.threshold)),
      series: [
        {
          name: "Elastic mean F1",
          values: sideBySide.overall.elastic_threshold_sweep.map((t) => pct(t.mean_f1)),
        },
        {
          name: "Elastic mean precision",
          values: sideBySide.overall.elastic_threshold_sweep.map((t) => pct(t.mean_precision)),
        },
      ],
      colors: [palette.amber, palette.blue],
      yMax: 100,
      yStep: 20,
    })
  );

  const capacityEnvelopeSvgPath = writeSvgAsset(
    "capacity_envelope.svg",
    buildLineChartSvg({
      labels: performance.stages.map((s) => String(s.target_dynamic_rules)),
      series: [
        {
          name: "Evaluation duration",
          values: performance.stages.map((s) => s.evaluation_duration_seconds),
        },
        {
          name: "Safety threshold",
          values: performance.stages.map(() => 1.5),
        },
      ],
      colors: [palette.blue, palette.rose],
      yMax: 2,
      yStep: 0.5,
      yTickFormatter: (value) => `${value.toFixed(1)}s`,
      pointFormatter: (value) => `${value.toFixed(2)}s`,
    })
  );

  // Slide 3 overall metrics
  slide = pptx.addSlide();
  slide.background = { color: palette.white };
  addHeader(
    slide,
    "Functional Quality",
    "Overall quality metrics",
    "Precision, recall ve F1 bazinda tuned profil ile Elastic trial ayni eksende gorunuyor."
  );
  slide.addShape(SHAPE.roundRect, {
    x: 0.68,
    y: 1.72,
    w: 7.35,
    h: 4.62,
    rectRadius: 0.08,
    fill: { color: "F9FBFE" },
    line: { color: palette.line, pt: 1 },
  });
  slide.addImage({
    path: overallQualitySvgPath,
    ...imageSizingContain(overallQualitySvgPath, 0.85, 1.92, 6.95, 4.12),
  });
  addStatCard(
    slide,
    8.42,
    1.78,
    4.16,
    1.2,
    palette.emerald,
    formatPct(tuning.overall.tuned_mean_f1),
    "En iyi kalite",
    "Tuned profil, benchmark suite uzerinde 6/6 pass veriyor."
  );
  addStatCard(
    slide,
    8.42,
    3.1,
    4.16,
    1.2,
    palette.teal,
    formatPct(functional.overall.mean_f1),
    "Default davranis",
    "Varsayilan profil bile 6 use case'in 5'inde hedef kaliteyi koruyor."
  );
  addStatCard(
    slide,
    8.42,
    4.42,
    4.16,
    1.2,
    palette.amber,
    formatPct(sideBySide.overall.elastic_best_mean_f1),
    "Elastic best threshold",
    "Elastic threshold sweep sonrasinda ulasilan en iyi mean F1 seviyesi."
  );
  slide.addText(
    `Not: Elastic standard threshold=25 icin recall ${formatPct(standardRecall)} seviyesinde kaldi; bu benchmark setinde anlamli bir under-detection goruldu.`,
    {
      x: 0.7,
      y: 6.52,
      w: 11.55,
      h: 0.28,
      fontFace: "Aptos",
      fontSize: 9.2,
      color: palette.muted,
      margin: 0,
    }
  );
  addFooter(slide, 3);
  validateSlide(slide, pptx);

  // Slide 4 scenario chart
  slide = pptx.addSlide();
  slide.background = { color: "FBFCFE" };
  addHeader(
    slide,
    "Scenario Matrix",
    "Scenario bazli F1 karsilastirmasi",
    "En buyuk kazanc, subtle level shift use case'inde tuned profil ile gorunuyor."
  );
  slide.addShape(SHAPE.roundRect, {
    x: 0.68,
    y: 1.72,
    w: 8.2,
    h: 4.98,
    rectRadius: 0.08,
    fill: { color: palette.white },
    line: { color: palette.line, pt: 1 },
  });
  const tableX = 0.9;
  const tableY = 1.98;
  const rowH = 0.56;
  const colScenario = 2.62;
  const colMetric = 1.38;
  slide.addShape(SHAPE.roundRect, {
    x: tableX,
    y: tableY,
    w: colScenario,
    h: rowH,
    rectRadius: 0.04,
    fill: { color: "EEF4FB" },
    line: { color: "D3DFEE", pt: 1 },
  });
  slide.addText("Scenario", {
    x: tableX + 0.12,
    y: tableY + 0.15,
    w: colScenario - 0.2,
    h: 0.2,
    fontFace: "Aptos",
    fontSize: 10.2,
    bold: true,
    color: palette.ink,
    margin: 0,
  });
  [
    { label: "Bizim default", color: palette.teal },
    { label: "Bizim tuned", color: palette.emerald },
    { label: "Elastic best", color: palette.amber },
  ].forEach((col, idx) => {
    const x = tableX + colScenario + idx * (colMetric + 0.08);
    slide.addShape(SHAPE.roundRect, {
      x,
      y: tableY,
      w: colMetric,
      h: rowH,
      rectRadius: 0.04,
      fill: { color: col.color },
      line: { color: col.color, pt: 1 },
    });
    slide.addText(col.label, {
      x: x + 0.08,
      y: tableY + 0.14,
      w: colMetric - 0.16,
      h: 0.24,
      fontFace: "Aptos",
      fontSize: 9.1,
      bold: true,
      color: palette.white,
      margin: 0,
      align: "ctr",
    });
  });

  sideBySide.scenarios.forEach((scenario, rowIndex) => {
    const y = tableY + rowH + 0.08 + rowIndex * 0.62;
    slide.addShape(SHAPE.roundRect, {
      x: tableX,
      y,
      w: colScenario,
      h: 0.5,
      rectRadius: 0.03,
      fill: { color: rowIndex % 2 === 0 ? "F8FBFE" : "F1F6FB" },
      line: { color: "E0E8F1", pt: 0.8 },
    });
    slide.addText(labelize(scenario.name), {
      x: tableX + 0.12,
      y: y + 0.13,
      w: colScenario - 0.24,
      h: 0.18,
      fontFace: "Aptos",
      fontSize: 9.6,
      bold: rowIndex === 5,
      color: palette.ink,
      margin: 0,
    });

    const values = [
      pct(scenario.default.f1),
      pct(scenario.tuned.f1),
      pct(scenario.elastic_best.f1),
    ];
    values.forEach((value, idx) => {
      const x = tableX + colScenario + idx * (colMetric + 0.08);
      slide.addShape(SHAPE.roundRect, {
        x,
        y,
        w: colMetric,
        h: 0.5,
        rectRadius: 0.03,
        fill: { color: metricCellFill(value) },
        line: { color: "E0E8F1", pt: 0.8 },
      });
      slide.addText(`${value.toFixed(1)}%`, {
        x,
        y: y + 0.12,
        w: colMetric,
        h: 0.18,
        fontFace: "Aptos Display",
        fontSize: 11,
        bold: true,
        color: metricCellText(value),
        margin: 0,
        align: "ctr",
      });
    });
  });
  addCallout(
    slide,
    9.18,
    1.84,
    3.52,
    1.34,
    "Where we clearly lead",
    "Latency spike, error burst, traffic drop ve resource step-up use case'lerinde tuned ve default profil tam skor seviyesinde.",
    palette.emerald
  );
  addCallout(
    slide,
    9.18,
    3.42,
    3.52,
    1.34,
    "Only remaining default gap",
    "Subtle shift senaryosunda default F1 73.7%; tuned profil 95.7% ile bunu kapatiyor.",
    palette.blue
  );
  addCallout(
    slide,
    9.18,
    5.0,
    3.52,
    1.34,
    "Elastic'in guclu kaldigi alan",
    "Seasonal hourly spike senaryosunda Elastic best threshold 1.0 ile 100% F1 seviyesine cikabiliyor.",
    palette.amber
  );
  addFooter(slide, 4);
  validateSlide(slide, pptx);

  // Slide 5 visual latency
  slide = pptx.addSlide();
  slide.background = { color: palette.white };
  addVisualComparison(
    slide,
    "latency_spike_mad",
    "Visual benchmark | latency spike",
    "Kisa ve yuksek amplitudlu spike patternde hem default hem tuned profil tam skor veriyor.",
    "Latency spike use case'inde bizim detector iki profilde de spike'i temiz sekilde ayiriyor; Elastic ise ayni veri setinde daha muhafazakar kaliyor ve threshold'a duyarlilik gosteriyor."
  );
  addFooter(slide, 5);
  validateSlide(slide, pptx);

  // Slide 6 visual subtle shift
  slide = pptx.addSlide();
  slide.background = { color: palette.white };
  addVisualComparison(
    slide,
    "subtle_level_shift_ewma",
    "Visual benchmark | subtle sustained level shift",
    "Bu use case, tuning'in neden gerekli oldugunu en net gosteren senaryodur.",
    "Default EWMA davranisi degisimi goruyor ama tam kapsama ulasamiyor. Tuned profil MAD 3.2 / window 30 ile sapmayi belirginlestiriyor ve Elastic'in best-threshold sonucunu da geride birakiyor."
  );
  addFooter(slide, 6);
  validateSlide(slide, pptx);

  // Slide 7 threshold sensitivity and improvements
  slide = pptx.addSlide();
  slide.background = { color: "FBFCFE" };
  addHeader(
    slide,
    "Elastic Sensitivity",
    "Threshold sweep neden onemliydi?",
    "Elastic tarafinda standard threshold=25, bu suite icin fazla muhafazakar kaldi."
  );
  slide.addShape(SHAPE.roundRect, {
    x: 0.68,
    y: 1.76,
    w: 6.8,
    h: 4.62,
    rectRadius: 0.08,
    fill: { color: "F9FBFE" },
    line: { color: palette.line, pt: 1 },
  });
  slide.addImage({
    path: elasticSweepSvgPath,
    ...imageSizingContain(elasticSweepSvgPath, 0.92, 1.98, 6.32, 4.12),
  });
  addCallout(
    slide,
    7.95,
    1.86,
    4.34,
    1.02,
    "Best threshold bulgusu",
    "Bu benchmark setinde en iyi toplu F1, Elastic icin threshold=1.0 noktasinda olustu.",
    palette.amber
  );
  addCallout(
    slide,
    7.95,
    3.0,
    4.34,
    1.02,
    "Benchmark'tan gelen urun iyilestirmeleri",
    "Window score, seasonal fallback ve preset kalibrasyonu direkt benchmark geri bildirimi ile sekillendi.",
    palette.emerald
  );
  addCallout(
    slide,
    7.95,
    4.14,
    4.34,
    1.02,
    "Panelde gorunen yeni alanlar",
    "Selected anomaly kartinda point score, window score ve primary driver artik net gorunuyor.",
    palette.blue
  );
  addCallout(
    slide,
    7.95,
    5.28,
    4.34,
    1.02,
    "Bir sonraki urun aksiyonu",
    "Subtle shift odakli yeni preset ve daha guclu auto recommendation mantigi eklenmeli.",
    palette.rose
  );
  addFooter(slide, 7);
  validateSlide(slide, pptx);

  // Slide 8 capacity
  slide = pptx.addSlide();
  slide.background = { color: palette.white };
  addHeader(
    slide,
    "Capacity Envelope",
    "Kapasite ve soak sonucu",
    "Teknik limit ile guvenli operasyon limiti ayri okunmali."
  );
  slide.addShape(SHAPE.roundRect, {
    x: 0.68,
    y: 1.76,
    w: 7.2,
    h: 4.55,
    rectRadius: 0.08,
    fill: { color: "F9FBFE" },
    line: { color: palette.line, pt: 1 },
  });
  slide.addImage({
    path: capacityEnvelopeSvgPath,
    ...imageSizingContain(capacityEnvelopeSvgPath, 0.94, 1.96, 6.7, 4.02),
  });
  addStatCard(
    slide,
    8.45,
    1.84,
    4.05,
    1.16,
    palette.emerald,
    "300 | PASS",
    "Soak verdict",
    `Evaluation duration ${formatSeconds(
      Math.max(...soak300.samples.map((s) => s.evaluation_duration_seconds))
    )} tavaninda kaldi.`
  );
  addStatCard(
    slide,
    8.45,
    3.16,
    4.05,
    1.16,
    palette.amber,
    "350 | RISK",
    "Borderline zone",
    `Bir ornekte ${formatSeconds(
      Math.max(...soak350.samples.map((s) => s.evaluation_duration_seconds))
    )} goruldu.`
  );
  addStatCard(
    slide,
    8.45,
    4.48,
    4.05,
    1.16,
    palette.rose,
    "400 | RISK",
    "Unsafe without optimization",
    `Iki ornekte ${formatSeconds(
      Math.max(...soak400.samples.map((s) => s.evaluation_duration_seconds))
    )} seviyesine cikti.`
  );
  slide.addText(
    "Karar: teknik olarak 400 seviyesine ulasilabiliyor; fakat kisa soak verisi, guvenli operasyon tavaninin 300 detector civarinda tutulmasi gerektigini gosteriyor.",
    {
      x: 0.72,
      y: 6.48,
      w: 11.45,
      h: 0.34,
      fontFace: "Aptos",
      fontSize: 10,
      bold: true,
      color: palette.ink,
      margin: 0,
    }
  );
  addFooter(slide, 8);
  validateSlide(slide, pptx);

  // Slide 9 closing
  slide = pptx.addSlide();
  slide.background = { color: palette.navy };
  addHeader(
    slide,
    "Recommendation",
    "Ne sonucu cikarmaliyiz?",
    "Sunumun kapanis slaydi: karar, risk ve bir sonraki urun adimlari.",
    { dark: true }
  );
  addStatCard(
    slide,
    0.68,
    1.92,
    3.88,
    1.55,
    palette.emerald,
    "Ship beta",
    "Teknik karar",
    "Mevcut build beta duyurusu ve kontrollu kullanici denemesi icin yeterli olgunlukta.",
    true
  );
  addStatCard(
    slide,
    4.74,
    1.92,
    3.88,
    1.55,
    palette.blue,
    "Target 300",
    "Kapasite karari",
    "Operasyonel planlama ve ilk onboarding icin 300 dynamic detector limiti kullanilmali.",
    true
  );
  addStatCard(
    slide,
    8.8,
    1.92,
    3.88,
    1.55,
    palette.amber,
    "Tune subtle shift",
    "Tek acik alan",
    "Subtle sustained shift icin yeni preset ve recommendation mantigi urune eklenmeli.",
    true
  );
  addCallout(
    slide,
    0.72,
    4.02,
    3.8,
    1.84,
    "Bir sonraki urun sprint'i",
    "Subtle shift preset'i ekle, auto recommendation kurallarini guncelle ve dashboard + render + alert checks acik uzun soak tekrarini al.",
    palette.emerald
  );
  addCallout(
    slide,
    4.76,
    4.02,
    3.8,
    1.84,
    "Sunumla birlikte acilacak dosyalar",
    "Final benchmark raporu, side-by-side HTML ve kod/teslim notlari ayni teslim paketinde yer aliyor.",
    palette.blue
  );
  addCallout(
    slide,
    8.8,
    4.02,
    3.8,
    1.84,
    "Ana mesaj",
    "Ayni dataset uzerinde detector su an Elastic ML trial kosusunu geciyor; artik odak kapsam genisletme ve operasyonel sertlestirme olmali.",
    palette.amber
  );
  slide.addText(desktopBenchmarkRoot, {
    x: 0.74,
    y: 6.48,
    w: 11.6,
    h: 0.28,
    fontFace: "Aptos",
    fontSize: 9,
    color: "BDD2EA",
    margin: 0,
  });
  addFooter(slide, 9);
  validateSlide(slide, pptx);

  const outPath = path.join(
    __dirname,
    "Grafana_Anomaly_Detector_Benchmark_TR.pptx"
  );
  await pptx.writeFile({ fileName: outPath });
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
