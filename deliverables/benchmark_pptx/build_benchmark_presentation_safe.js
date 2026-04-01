const fs = require("fs");
const path = require("path");
const PptxGenJS = require("pptxgenjs");
const { imageSizingContain } = require("./pptxgenjs_helpers/image");
const { safeOuterShadow } = require("./pptxgenjs_helpers/util");

const repoRoot = path.resolve(__dirname, "..", "..");
const benchmarkRoot = path.join(repoRoot, "benchmarks");
const pptxProbe = new PptxGenJS();
const SHAPE = pptxProbe.ShapeType;

const palette = {
  ink: "122033",
  slate: "526277",
  muted: "6D7B90",
  line: "D7DEE8",
  white: "FFFFFF",
  navy: "0E223F",
  teal: "0F8B8D",
  emerald: "2AA66D",
  amber: "F2A541",
  rose: "D95D5D",
  blue: "3E7BFA",
};

const generatedAssetsDir = path.join(__dirname, "generated_assets_safe");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function writeSvgAsset(name, svg) {
  ensureDir(generatedAssetsDir);
  const outPath = path.join(generatedAssetsDir, name);
  fs.writeFileSync(outPath, svg, "utf8");
  return outPath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function pct(v) {
  return Math.round(v * 1000) / 10;
}

function formatPct(v) {
  return `${pct(v).toFixed(1)}%`;
}

function formatSeconds(v) {
  return `${v.toFixed(2)}s`;
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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
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

function buildLineChartSvg({ labels, series, colors, yMax, yStep, yTickFormatter, pointFormatter }) {
  const width = 980;
  const height = 560;
  const margin = { top: 30, right: 24, bottom: 72, left: 72 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const xStep = labels.length > 1 ? plotW / (labels.length - 1) : plotW;
  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
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
  series.forEach((serie, idx) => {
    const pts = serie.values.map((value, i) => {
      const x = margin.left + i * xStep;
      const y = margin.top + plotH - (value / yMax) * plotH;
      return { x, y, value };
    });
    lines.push(`<polyline fill="none" stroke="#${colors[idx]}" stroke-width="3" points="${pts.map((p) => `${p.x},${p.y}`).join(" ")}"/>`);
    pts.forEach((p) => {
      lines.push(`<circle cx="${p.x}" cy="${p.y}" r="4.5" fill="#${colors[idx]}"/>`);
      lines.push(`<text x="${p.x}" y="${p.y - 9}" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="#243446">${escapeXml(pointFormatter(p.value))}</text>`);
    });
  });
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

function addHeader(slide, section, title, subtitle, dark = false) {
  slide.addText(section.toUpperCase(), {
    x: 0.58, y: 0.28, w: 2.8, h: 0.18,
    fontFace: "Aptos", fontSize: 9, bold: true,
    color: dark ? "A9D8FF" : palette.blue, charSpace: 1.5, margin: 0,
  });
  slide.addText(title, {
    x: 0.58, y: 0.54, w: 8.8, h: 0.42,
    fontFace: "Aptos Display", fontSize: 23, bold: true,
    color: dark ? palette.white : palette.ink, margin: 0,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.6, y: 1.02, w: 8.6, h: 0.38,
      fontFace: "Aptos", fontSize: 10.5,
      color: dark ? "D7E7FA" : palette.slate, margin: 0,
    });
  }
}

function addFooter(slide, index) {
  slide.addText(`Benchmark deck | ${index}`, {
    x: 12.3, y: 7.08, w: 0.55, h: 0.18, align: "right",
    fontFace: "Aptos", fontSize: 8, color: "8EA0B8", margin: 0,
  });
}

function addStatCard(slide, x, y, w, h, accent, value, label, note, dark = false) {
  const compact = h < 1.3;
  const valueY = compact ? y + 0.16 : y + 0.24;
  const valueH = compact ? 0.34 : 0.46;
  const valueFont = compact ? 18 : 22;
  const labelY = compact ? y + 0.52 : y + 0.76;
  const labelH = compact ? 0.16 : 0.26;
  const labelFont = compact ? 9 : 10.5;
  const noteY = compact ? y + 0.76 : y + 1.08;
  const noteH = compact ? Math.max(0.18, h - 0.84) : Math.max(0.22, h - 1.22);
  const noteFont = compact ? 8.1 : 9;
  slide.addShape(SHAPE.roundRect, {
    x, y, w, h,
    fill: { color: dark ? "143258" : palette.white },
    line: { color: dark ? "224A7A" : palette.line, pt: 1 },
    shadow: safeOuterShadow("172434", 0.16, 45, 2, 1),
  });
  slide.addShape(SHAPE.roundRect, {
    x: x + 0.18, y: y + 0.18, w: 0.12, h: h - 0.36,
    fill: { color: accent }, line: { color: accent, pt: 0 },
  });
  slide.addText(value, {
    x: x + 0.42, y: valueY, w: w - 0.55, h: valueH,
    fontFace: "Aptos Display", fontSize: valueFont, bold: true,
    color: dark ? palette.white : palette.ink, margin: 0,
  });
  slide.addText(label, {
    x: x + 0.42, y: labelY, w: w - 0.55, h: labelH,
    fontFace: "Aptos", fontSize: labelFont, bold: true,
    color: dark ? "E3EEFA" : palette.slate, margin: 0,
  });
  slide.addText(note, {
    x: x + 0.42, y: noteY, w: w - 0.55, h: noteH,
    fontFace: "Aptos", fontSize: noteFont, color: dark ? "B6C9E4" : palette.muted, margin: 0,
  });
}

function addCallout(slide, x, y, w, h, title, body, accent) {
  slide.addShape(SHAPE.roundRect, {
    x, y, w, h,
    fill: { color: "F8FBFF" },
    line: { color: accent, pt: 1.2 },
  });
  slide.addText(title, {
    x: x + 0.18, y: y + 0.14, w: w - 0.32, h: 0.22,
    fontFace: "Aptos", fontSize: 10.5, bold: true, color: palette.ink, margin: 0,
  });
  slide.addText(body, {
    x: x + 0.18, y: y + 0.44, w: w - 0.32, h: h - 0.56,
    fontFace: "Aptos", fontSize: 9.2, color: palette.slate, margin: 0,
  });
}

function addVisualComparison(slide, scenarioName, title, subtitle, note) {
  addHeader(slide, "Visual Benchmark", title, subtitle);
  const boxes = [
    { x: 0.58, label: "Bizim detector | Default", variant: "default", accent: palette.teal },
    { x: 4.52, label: "Bizim detector | Tuned", variant: "tuned", accent: palette.emerald },
    { x: 8.46, label: "Elastic ML | Real export", variant: "elastic", accent: palette.amber },
  ];
  boxes.forEach((box) => {
    slide.addShape(SHAPE.roundRect, {
      x: box.x, y: 1.63, w: 3.72, h: 4.64,
      fill: { color: palette.white }, line: { color: palette.line, pt: 1 },
      shadow: safeOuterShadow("172434", 0.1, 45, 2, 1),
    });
    slide.addShape(SHAPE.roundRect, {
      x: box.x + 0.16, y: 1.79, w: 0.1, h: 0.42,
      fill: { color: box.accent }, line: { color: box.accent, pt: 0 },
    });
    slide.addText(box.label, {
      x: box.x + 0.34, y: 1.78, w: 3.0, h: 0.24,
      fontFace: "Aptos", fontSize: 10, bold: true, color: palette.ink, margin: 0,
    });
    const imagePath = path.join(benchmarkRoot, "elastic_side_by_side", "outputs", "visual_report", `${scenarioName}.${box.variant}.png`);
    slide.addImage({ path: imagePath, ...imageSizingContain(imagePath, box.x + 0.18, 2.15, 3.36, 3.48) });
  });
  addCallout(slide, 0.58, 6.44, 11.62, 0.48, "Gorsel yorum", note, palette.blue);
}

async function main() {
  const functional = readJson(path.join(benchmarkRoot, "functional", "outputs", "functional_benchmark_summary.json"));
  const tuning = readJson(path.join(benchmarkRoot, "functional", "outputs", "functional_tuning_sweep_summary.json"));
  const sideBySide = readJson(path.join(benchmarkRoot, "elastic_side_by_side", "outputs", "scored_comparisons", "side_by_side_metrics.json"));
  const performance = readJson(path.join(benchmarkRoot, "performance", "outputs", "detector_scale_extended_summary.json"));
  const soak300 = readJson(path.join(benchmarkRoot, "soak", "outputs", "soak_profile_300.example.summary.json"));
  const soak350 = readJson(path.join(benchmarkRoot, "soak", "outputs", "soak_profile_350.example.summary.json"));
  const soak400 = readJson(path.join(benchmarkRoot, "soak", "outputs", "soak_profile_400.example.summary.json"));
  const elasticStandardSweep = sideBySide.overall.elastic_threshold_sweep.find((item) => item.threshold === sideBySide.overall.elastic_standard_threshold);
  const elasticBestSweep = sideBySide.overall.elastic_threshold_sweep.find((item) => item.threshold === sideBySide.overall.elastic_best_threshold);

  const overallChart = writeSvgAsset(
    "overall_quality.svg",
    buildGroupedBarSvg({
      categories: ["Precision", "Recall", "F1"],
      series: [
        { name: "Bizim default", values: [pct(functional.overall.mean_precision), pct(functional.overall.mean_recall), pct(functional.overall.mean_f1)] },
        { name: "Bizim tuned", values: [pct(tuning.overall.tuned_mean_precision), pct(tuning.overall.tuned_mean_recall), pct(tuning.overall.tuned_mean_f1)] },
        { name: "Elastic best", values: [pct(sideBySide.overall.elastic_best_mean_precision), pct(elasticBestSweep.mean_recall), pct(sideBySide.overall.elastic_best_mean_f1)] },
        { name: "Elastic standard", values: [pct(sideBySide.overall.elastic_standard_mean_precision), pct(elasticStandardSweep.mean_recall), pct(sideBySide.overall.elastic_standard_mean_f1)] },
      ],
      colors: [palette.teal, palette.emerald, palette.amber, palette.rose],
    })
  );
  const overallChartPng = path.join(generatedAssetsDir, "overall_quality.png");

  const sweepChart = writeSvgAsset(
    "elastic_threshold_sweep.svg",
    buildLineChartSvg({
      labels: sideBySide.overall.elastic_threshold_sweep.map((t) => String(t.threshold)),
      series: [
        { name: "Elastic mean F1", values: sideBySide.overall.elastic_threshold_sweep.map((t) => pct(t.mean_f1)) },
        { name: "Elastic mean precision", values: sideBySide.overall.elastic_threshold_sweep.map((t) => pct(t.mean_precision)) },
      ],
      colors: [palette.amber, palette.blue],
      yMax: 100,
      yStep: 20,
      yTickFormatter: (v) => `${v}`,
      pointFormatter: (v) => `${v.toFixed(1)}`,
    })
  );
  const sweepChartPng = path.join(generatedAssetsDir, "elastic_threshold_sweep.png");

  const capacityChart = writeSvgAsset(
    "capacity_envelope.svg",
    buildLineChartSvg({
      labels: performance.stages.map((s) => String(s.target_dynamic_rules)),
      series: [
        { name: "Evaluation duration", values: performance.stages.map((s) => s.evaluation_duration_seconds) },
        { name: "Safety threshold", values: performance.stages.map(() => 1.5) },
      ],
      colors: [palette.blue, palette.rose],
      yMax: 2,
      yStep: 0.5,
      yTickFormatter: (v) => `${v.toFixed(1)}s`,
      pointFormatter: (v) => `${v.toFixed(2)}s`,
    })
  );
  const capacityChartPng = path.join(generatedAssetsDir, "capacity_envelope.png");

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "OpenAI Codex";
  pptx.company = "Turkcell";
  pptx.subject = "Grafana Anomaly Detector Benchmark";
  pptx.title = "Grafana Anomaly Detector Benchmark 2026";
  pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos", lang: "tr-TR" };

  let slide = pptx.addSlide();
  slide.background = { color: palette.navy };
  slide.addText("GRAFANA ANOMALY DETECTOR", {
    x: 0.62, y: 0.46, w: 4.6, h: 0.26,
    fontFace: "Aptos", fontSize: 10, bold: true, color: "9FD2FF", charSpace: 2.2, margin: 0,
  });
  slide.addText("Benchmark Sonuclari\nve Elastic Side-by-Side Degerlendirmesi", {
    x: 0.58, y: 0.92, w: 7.35, h: 1.55,
    fontFace: "Aptos Display", fontSize: 26, bold: true, color: palette.white, margin: 0,
  });
  slide.addText("Ayni labeled dataset uzerinde kalite, Elastic davranisi ve kapasite limiti.", {
    x: 0.6, y: 2.54, w: 6.65, h: 0.42,
    fontFace: "Aptos", fontSize: 11.5, color: "D7E7FA", margin: 0,
  });
  addStatCard(slide, 0.62, 4.08, 2.88, 1.55, palette.emerald, formatPct(tuning.overall.tuned_mean_f1), "Bizim tuned mean F1", "Ayni benchmark suite icinde erisilen en iyi kalite.");
  addStatCard(slide, 3.67, 4.08, 2.88, 1.55, palette.amber, formatPct(sideBySide.overall.elastic_best_mean_f1), "Elastic best mean F1", "Threshold sweep sonrasi Elastic icin bulunan en iyi seviye.");
  addStatCard(slide, 6.72, 4.08, 2.88, 1.55, palette.teal, `${functional.overall.scenario_count}`, "Labeled benchmark senaryosu", "Latency, error, traffic, seasonal, resource ve subtle shift use case'leri.");
  addStatCard(slide, 9.77, 4.08, 2.88, 1.55, palette.blue, "300", "Guvenli detector limiti", "Kisa soak sonucuna gore onerilen operasyonel tavan.");
  addCallout(slide, 8.05, 0.96, 4.48, 2.1, "Ana karar", "Bu benchmark turunda tuned detector, ayni dataset uzerinde Elastic ML trial kosusundan daha iyi performans verdi. Default profil ise 6 use case'in 5'inde hedef kaliteyi koruyor.", palette.blue);
  addFooter(slide, 1);

  slide = pptx.addSlide();
  slide.background = { color: "FBFCFE" };
  addHeader(slide, "Functional Quality", "Benchmark ozet tablosu", "Overall quality chart ve senaryo bazli F1 matrisi ayni slaytta toplandi.");
  slide.addShape(SHAPE.roundRect, { x: 0.68, y: 1.62, w: 5.7, h: 2.85, fill: { color: palette.white }, line: { color: palette.line, pt: 1 } });
  slide.addImage({ path: overallChartPng, ...imageSizingContain(overallChartPng, 0.88, 1.84, 5.3, 2.4) });
  addCallout(slide, 6.64, 1.68, 5.6, 1.05, "Kalite karari", `Default mean F1 ${formatPct(functional.overall.mean_f1)} | Tuned mean F1 ${formatPct(tuning.overall.tuned_mean_f1)} | Elastic best mean F1 ${formatPct(sideBySide.overall.elastic_best_mean_f1)}`, palette.emerald);
  addCallout(slide, 6.64, 2.88, 5.6, 1.05, "Elastic threshold notu", `Standard threshold=25 icin recall ${formatPct(elasticStandardSweep.mean_recall)} seviyesinde kaldi; best threshold 1.0 oldu.`, palette.amber);
  addCallout(slide, 6.64, 4.08, 5.6, 1.05, "Kodu iyilestiren ana basliklar", "Seasonal fallback, window-context score ve panelde point/window/driver detaylarinin acilmasi.", palette.blue);
  slide.addShape(SHAPE.roundRect, { x: 0.68, y: 4.82, w: 11.56, h: 1.52, fill: { color: palette.white }, line: { color: palette.line, pt: 1 } });
  const sx = 0.84;
  const sy = 5.02;
  const scenarioCol = 2.4;
  const metricCol = 1.45;
  slide.addText("Scenario", { x: sx, y: sy, w: scenarioCol, h: 0.18, fontFace: "Aptos", fontSize: 9.6, bold: true, color: palette.ink, margin: 0 });
  slide.addText("Default F1", { x: sx + scenarioCol, y: sy, w: metricCol, h: 0.18, fontFace: "Aptos", fontSize: 9.6, bold: true, color: palette.teal, margin: 0, align: "ctr" });
  slide.addText("Tuned F1", { x: sx + scenarioCol + metricCol + 0.1, y: sy, w: metricCol, h: 0.18, fontFace: "Aptos", fontSize: 9.6, bold: true, color: palette.emerald, margin: 0, align: "ctr" });
  slide.addText("Elastic best", { x: sx + scenarioCol + 2*(metricCol + 0.1), y: sy, w: metricCol, h: 0.18, fontFace: "Aptos", fontSize: 9.6, bold: true, color: palette.amber, margin: 0, align: "ctr" });
  sideBySide.scenarios.forEach((scenario, idx) => {
    const y = sy + 0.26 + idx * 0.19;
    slide.addText(labelize(scenario.name), { x: sx, y, w: scenarioCol, h: 0.16, fontFace: "Aptos", fontSize: 8.8, color: palette.ink, margin: 0 });
    const values = [pct(scenario.default.f1), pct(scenario.tuned.f1), pct(scenario.elastic_best.f1)];
    values.forEach((value, vidx) => {
      const x = sx + scenarioCol + vidx * (metricCol + 0.1);
      slide.addShape(SHAPE.roundRect, { x, y: y - 0.01, w: metricCol, h: 0.16, fill: { color: value >= 95 ? "E7F6EE" : value >= 85 ? "EAF2FF" : value >= 70 ? "FFF2DE" : "FCE6E6" }, line: { color: "E0E8F1", pt: 0.6 } });
      slide.addText(`${value.toFixed(1)}%`, { x, y: y + 0.02, w: metricCol, h: 0.12, fontFace: "Aptos Display", fontSize: 8.4, bold: true, color: value >= 95 ? palette.emerald : value >= 85 ? palette.blue : value >= 70 ? palette.amber : palette.rose, margin: 0, align: "ctr" });
    });
  });
  addFooter(slide, 2);

  slide = pptx.addSlide();
  slide.background = { color: palette.white };
  addVisualComparison(
    slide,
    "latency_spike_mad",
    "Visual benchmark | latency spike",
    "Kisa ve yuksek amplitudlu spike patternde default ve tuned profil tam skor veriyor.",
    "Latency spike use case'inde bizim detector spike'i temiz sekilde ayiriyor; Elastic ayni veri setinde daha muhafazakar kaliyor."
  );
  addFooter(slide, 3);

  slide = pptx.addSlide();
  slide.background = { color: palette.white };
  addVisualComparison(
    slide,
    "subtle_level_shift_ewma",
    "Visual benchmark | subtle sustained level shift",
    "Bu use case tuning'in urune neden gerekli oldugunu en net gosteren senaryodur.",
    "Default EWMA davranisi degisimi goruyor ama tam kapsama ulasamiyor. Tuned MAD 3.2 / window 30 profili bu acigi kapatiyor."
  );
  addFooter(slide, 4);

  slide = pptx.addSlide();
  slide.background = { color: "FBFCFE" };
  addHeader(slide, "Elastic Sensitivity", "Threshold sweep ve kod iyilestirmeleri", "Elastic threshold duyarliligi ile urune tasinan gelistirmeler ayni karede.");
  slide.addShape(SHAPE.roundRect, { x: 0.68, y: 1.72, w: 6.85, h: 4.58, fill: { color: palette.white }, line: { color: palette.line, pt: 1 } });
  slide.addImage({ path: sweepChartPng, ...imageSizingContain(sweepChartPng, 0.92, 1.94, 6.36, 4.08) });
  addCallout(slide, 7.88, 1.84, 4.36, 0.96, "Best threshold bulgusu", "Elastic icin en iyi toplu F1, threshold=1.0 noktasinda olustu.", palette.amber);
  addCallout(slide, 7.88, 2.96, 4.36, 0.96, "Seasonal sertlestirme", "weekday_hour sparse kaldiginda hour_of_day fallback eklendi.", palette.emerald);
  addCallout(slide, 7.88, 4.08, 4.36, 0.96, "Window-context scoring", "EWMA akisina Elastic benzeri multi-bucket etkisi eklendi.", palette.blue);
  addCallout(slide, 7.88, 5.20, 4.36, 0.96, "Panel explainability", "Selected anomaly kartinda point score, window score ve primary driver gosteriliyor.", palette.rose);
  addFooter(slide, 5);

  slide = pptx.addSlide();
  slide.background = { color: palette.white };
  addHeader(slide, "Capacity Envelope", "Kapasite, soak ve karar", "Teknik limit ile guvenli operasyon seviyesi ayri okunmali.");
  slide.addShape(SHAPE.roundRect, { x: 0.68, y: 1.72, w: 7.2, h: 4.55, fill: { color: "F9FBFE" }, line: { color: palette.line, pt: 1 } });
  slide.addImage({ path: capacityChartPng, ...imageSizingContain(capacityChartPng, 0.94, 1.94, 6.7, 4.02) });
  addStatCard(slide, 8.45, 1.84, 4.05, 1.16, palette.emerald, "300 | PASS", "Soak verdict", `Evaluation duration ${formatSeconds(Math.max(...soak300.samples.map((s) => s.evaluation_duration_seconds)))} tavaninda kaldi.`);
  addStatCard(slide, 8.45, 3.16, 4.05, 1.16, palette.amber, "350 | RISK", "Borderline zone", `Bir ornekte ${formatSeconds(Math.max(...soak350.samples.map((s) => s.evaluation_duration_seconds)))} goruldu.`);
  addStatCard(slide, 8.45, 4.48, 4.05, 1.16, palette.rose, "400 | RISK", "Unsafe without optimization", `Iki ornekte ${formatSeconds(Math.max(...soak400.samples.map((s) => s.evaluation_duration_seconds)))} seviyesine cikti.`);
  slide.addText("Karar: beta rollout icin kaliteli benchmark kaniti hazir. Operasyonel planlama 300 detector ile baslamali, subtle shift preset'i ise bir sonraki sprintte urune alinmali.", {
    x: 0.74, y: 6.5, w: 11.4, h: 0.28, fontFace: "Aptos", fontSize: 10, bold: true, color: palette.ink, margin: 0,
  });
  addFooter(slide, 6);

  const outPath = path.join(__dirname, "Grafana_Anomaly_Detector_Benchmark_TR_SAFE.pptx");
  await pptx.writeFile({ fileName: outPath });
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
