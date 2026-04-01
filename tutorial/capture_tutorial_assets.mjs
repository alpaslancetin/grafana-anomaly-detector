import { createRequire } from 'node:module';
const require = createRequire('C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/alpas-anomalydetector-panel/package.json');
const { chromium } = require('playwright');
import { mkdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = 'C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/tutorial';
const screenshotsDir = path.join(root, 'assets', 'screenshots');
const videoDir = path.join(root, 'assets', 'video');

const baseUrl = process.env.GRAFANA_URL ?? 'http://localhost:3000';
const grafanaUser = process.env.GRAFANA_USER ?? 'admin';
const grafanaPassword = process.env.GRAFANA_PASSWORD ?? 'admin';

const urls = {
  prometheusDashboard: `${baseUrl}/d/prometheus-live-anomaly-demo/prometheus-live-anomaly-demo?orgId=1&from=now-30m&to=now&refresh=5s`,
  prometheusPanel: `${baseUrl}/d/prometheus-live-anomaly-demo/prometheus-live-anomaly-demo?orgId=1&viewPanel=1&from=now-30m&to=now&refresh=5s`,
  singlePanel: `${baseUrl}/d/prometheus-live-anomaly-demo/prometheus-live-anomaly-demo?orgId=1&viewPanel=2&from=now-30m&to=now&refresh=5s`,
  prometheusEdit: `${baseUrl}/d/prometheus-live-anomaly-demo/prometheus-live-anomaly-demo?orgId=1&viewPanel=1&editPanel=1&from=now-30m&to=now&refresh=5s`,
  testdataDashboard: `${baseUrl}/d/anomaly-detector-demo/provisioned-anomaly-detector-demo?orgId=1`,
  testdataEdit: `${baseUrl}/d/anomaly-detector-demo/provisioned-anomaly-detector-demo?orgId=1&viewPanel=1&editPanel=1`,
};

async function ensureDirs() {
  await mkdir(screenshotsDir, { recursive: true });
  await mkdir(videoDir, { recursive: true });
}

async function loginGrafana(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const username = page.locator('input[name="user"]');
  if (!(await username.isVisible().catch(() => false))) {
    return;
  }

  await username.fill(grafanaUser);
  await page.locator('input[name="password"]').fill(grafanaPassword);
  await page.getByRole('button', { name: /log in|sign in/i }).first().click();
  await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

async function openAndWait(page, url, waitForText) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (waitForText) {
    await page
      .waitForFunction(
        (text) => (document.body?.innerText || '').includes(text),
        waitForText,
        { timeout: 120000 }
      )
      .catch(async () => {
        await page.waitForTimeout(8000);
      });
  }
  await page.waitForTimeout(7000);
}

async function clickFirst(locator) {
  const count = await locator.count().catch(() => 0);
  if (!count) {
    return false;
  }
  await locator.first().click({ force: true });
  return true;
}

async function revealExports(page) {
  for (let i = 0; i < 4; i += 1) {
    const showExports = page.getByRole('button', { name: /Show exports/i }).first();
    if (await showExports.isVisible().catch(() => false)) {
      await showExports.click({ force: true });
      await page.waitForTimeout(1200);
      return;
    }
    await page.mouse.wheel(0, 480);
    await page.waitForTimeout(900);
  }
}

async function revealScoreRules(page) {
  for (let i = 0; i < 4; i += 1) {
    const showRules = page.getByRole('button', { name: /Show synced rules|Show score rules/i }).first();
    if (await showRules.isVisible().catch(() => false)) {
      await showRules.click({ force: true });
      await page.waitForTimeout(1200);
      return;
    }
    await page.mouse.wheel(0, 420);
    await page.waitForTimeout(900);
  }
}

async function captureDashboardScreens(page) {
  await page.setViewportSize({ width: 1800, height: 1500 });
  await openAndWait(page, urls.prometheusDashboard, 'Prometheus latency anomaly (multi metric)');
  await page.screenshot({ path: path.join(screenshotsDir, '01-prometheus-dashboard-full.png'), fullPage: false });
  await page.screenshot({
    path: path.join(screenshotsDir, '02-prometheus-dashboard-top.png'),
    clip: { x: 120, y: 110, width: 1560, height: 860 },
  });
}

async function captureEditScreens(page) {
  await page.setViewportSize({ width: 1800, height: 1500 });
  await openAndWait(page, urls.prometheusEdit, 'Panel options');
  await page.screenshot({ path: path.join(screenshotsDir, '03-prometheus-edit-recommended.png'), fullPage: false });

  await openAndWait(page, urls.testdataDashboard, 'Synthetic anomaly stream');
  await page.screenshot({ path: path.join(screenshotsDir, '04-testdata-dashboard.png'), fullPage: false });

  await openAndWait(page, urls.testdataEdit, 'Panel options');
  const advanced = page.getByText('Advanced', { exact: true }).first();
  if (await advanced.isVisible().catch(() => false)) {
    await advanced.click({ force: true });
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: path.join(screenshotsDir, '05-testdata-edit-advanced.png'), fullPage: false });
}

async function captureMultiMetricDetail(page) {
  await page.setViewportSize({ width: 1800, height: 1850 });
  await openAndWait(page, urls.prometheusPanel, 'Detected incidents');
  await page.mouse.move(860, 410);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(screenshotsDir, '06-selected-anomaly-and-export.png'), fullPage: false });

  await revealExports(page);
  await page.screenshot({ path: path.join(screenshotsDir, '09-selected-anomaly-context.png'), fullPage: false });

  await revealScoreRules(page);
  await page.mouse.wheel(0, 520);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(screenshotsDir, '10-selected-anomaly-context-alt.png'), fullPage: false });
}

async function captureSingleMetricDetail(page) {
  await page.setViewportSize({ width: 1800, height: 1700 });
  await openAndWait(page, urls.singlePanel, 'Detected incidents');
  await page.screenshot({ path: path.join(screenshotsDir, '07-selected-anomaly-detail.png'), fullPage: false });

  await revealExports(page);
  const exportBlock = page.getByText(/Annotation export|Alert rule export/i).first();
  if (await exportBlock.isVisible().catch(() => false)) {
    await exportBlock.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1000);
  } else {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: path.join(screenshotsDir, '08-annotation-export.png'), fullPage: false });
}

async function captureWalkthroughVideo(browser) {
  const context = await browser.newContext({
    viewport: { width: 1800, height: 1200 },
    recordVideo: { dir: videoDir, size: { width: 1800, height: 1200 } },
  });

  const page = await context.newPage();
  await loginGrafana(page);
  await openAndWait(page, urls.prometheusPanel, 'Detected incidents');
  await page.waitForTimeout(2000);
  await page.mouse.move(520, 350);
  await page.waitForTimeout(1200);
  await page.mouse.move(860, 350);
  await page.waitForTimeout(1200);
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(1500);

  const video = page.video();
  await page.close();
  await context.close();

  if (!video) {
    throw new Error('Playwright video recording was not created.');
  }

  const videoPath = await video.path();
  const target = path.join(videoDir, 'anomaly-walkthrough.webm');
  await copyFile(videoPath, target);
  return target;
}

async function main() {
  await ensureDirs();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1800, height: 1500 } });

  try {
    await loginGrafana(page);
    await captureDashboardScreens(page);
    await captureEditScreens(page);
    await captureMultiMetricDetail(page);
    await captureSingleMetricDetail(page);
    const videoPath = await captureWalkthroughVideo(browser);
    const videoStats = await stat(videoPath);
    console.log(`Created screenshots in ${screenshotsDir}`);
    console.log(`Created video ${videoPath} (${videoStats.size} bytes)`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
