import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const outputDir = path.join(repoRoot, 'benchmarks', 'presentation', 'assets', 'screenshots');
const visualReportPath = path.join(
  repoRoot,
  'benchmarks',
  'elastic_side_by_side',
  'outputs',
  'visual_report',
  'side_by_side_visual_report.html'
);

const grafanaBaseUrl = process.env.GRAFANA_URL ?? 'http://localhost:3300';
const grafanaUser = process.env.GRAFANA_USER ?? 'admin';
const grafanaPassword = process.env.GRAFANA_PASSWORD ?? 'admin';

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function loginIfNeeded(page) {
  await page.goto(`${grafanaBaseUrl}/login`, { waitUntil: 'domcontentloaded' });
  const username = page.locator('input[name="user"]');
  if (!(await username.isVisible().catch(() => false))) {
    return;
  }

  await username.fill(grafanaUser);
  await page.locator('input[name="password"]').fill(grafanaPassword);
  const loginButton = page.getByRole('button', { name: /log in|sign in/i }).first();
  await loginButton.click();
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
}

async function captureGrafanaPanel(page, urlPath, title, filename) {
  await page.goto(`${grafanaBaseUrl}${urlPath}`, { waitUntil: 'domcontentloaded' });
  await page.getByText(title, { exact: true }).first().waitFor({ timeout: 60000 });

  const firstIncident = page.getByRole('button', { name: /Detected incident / }).first();
  if (await firstIncident.isVisible().catch(() => false)) {
    await firstIncident.click();
  }

  const chart = page.locator('svg[aria-label="Anomaly chart"]').first();
  await chart.waitFor({ timeout: 30000 });
  await page.screenshot({
    path: path.join(outputDir, filename),
    fullPage: true,
  });
}

async function captureVisualReport(page, scenarioName, filename) {
  await page.goto(pathToFileURL(visualReportPath).toString(), { waitUntil: 'domcontentloaded' });
  const section = page.locator('section.card').filter({ hasText: scenarioName }).first();
  await section.waitFor({ timeout: 30000 });
  await section.screenshot({
    path: path.join(outputDir, filename),
  });
}

async function main() {
  await ensureDir(outputDir);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1680, height: 1400 },
    deviceScaleFactor: 1.5,
  });

  try {
    await loginIfNeeded(page);

    await captureGrafanaPanel(
      page,
      '/d/prometheus-live-anomaly-demo/prometheus-live-anomaly-demo?orgId=1&viewPanel=1',
      'Prometheus latency anomaly (multi metric)',
      'grafana-multi-metric-premium.png'
    );

    await captureGrafanaPanel(
      page,
      '/d/prometheus-live-anomaly-demo/prometheus-live-anomaly-demo?orgId=1&viewPanel=2',
      'Prometheus request anomaly (single metric)',
      'grafana-single-metric-premium.png'
    );

    await captureVisualReport(page, 'latency_spike_mad', 'benchmark-side-by-side-latency.png');
    await captureVisualReport(page, 'subtle_level_shift', 'benchmark-side-by-side-level-shift.png');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
