import { createRequire } from 'node:module';
const require = createRequire('C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/alpas-anomalydetector-panel/package.json');
const { chromium } = require('playwright');
import { mkdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = 'C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/tutorial';
const screenshotsDir = path.join(root, 'assets', 'screenshots');
const videoDir = path.join(root, 'assets', 'video');
const baseUrl = 'http://localhost:3000';

const urls = {
  prometheusDashboard: `${baseUrl}/d/prometheus-live-anomaly-demo/prometheus-live-anomaly-demo?orgId=1&from=now-30m&to=now&refresh=5s`,
  prometheusEdit: `${baseUrl}/d/prometheus-live-anomaly-demo/prometheus-live-anomaly-demo?orgId=1&viewPanel=1&editPanel=1&from=now-30m&to=now&refresh=5s`,
  testdataDashboard: `${baseUrl}/d/anomaly-detector-demo/provisioned-anomaly-detector-demo?orgId=1`,
  testdataEdit: `${baseUrl}/d/anomaly-detector-demo/provisioned-anomaly-detector-demo?orgId=1&viewPanel=1&editPanel=1`,
};

async function ensureDirs() {
  await mkdir(screenshotsDir, { recursive: true });
  await mkdir(videoDir, { recursive: true });
}

async function waitForDashboard(page, titleText) {
  await page.goto(titleText.url, { waitUntil: 'domcontentloaded' });
  await page.getByText(titleText.waitFor, { exact: false }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(7000);
}

async function captureScreenshots(browser) {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1400 } });

  await waitForDashboard(page, { url: urls.prometheusDashboard, waitFor: 'Prometheus latency anomaly (multi metric)' });
  await page.screenshot({ path: path.join(screenshotsDir, '01-prometheus-dashboard-full.png'), fullPage: true });
  await page.screenshot({ path: path.join(screenshotsDir, '02-prometheus-dashboard-top.png'), fullPage: false });

  await waitForDashboard(page, { url: urls.prometheusEdit, waitFor: 'Panel options' });
  await page.screenshot({ path: path.join(screenshotsDir, '03-prometheus-edit-recommended.png'), fullPage: false });

  await waitForDashboard(page, { url: urls.testdataDashboard, waitFor: 'Synthetic anomaly stream' });
  await page.screenshot({ path: path.join(screenshotsDir, '04-testdata-dashboard.png'), fullPage: false });

  await waitForDashboard(page, { url: urls.testdataEdit, waitFor: 'Panel options' });
  await page.screenshot({ path: path.join(screenshotsDir, '05-testdata-edit-advanced.png'), fullPage: false });

  await page.close();
}

async function captureWalkthroughVideo(browser) {
  const context = await browser.newContext({
    viewport: { width: 1800, height: 1200 },
    recordVideo: { dir: videoDir, size: { width: 1800, height: 1200 } },
  });

  const page = await context.newPage();
  await waitForDashboard(page, { url: urls.prometheusDashboard, waitFor: 'Prometheus latency anomaly (multi metric)' });
  await page.getByRole('button', { name: /Combined anomaly at/i }).first().click();
  await page.waitForTimeout(2500);
  await page.mouse.move(520, 360);
  await page.waitForTimeout(1500);
  await page.mouse.move(760, 360);
  await page.waitForTimeout(1500);
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
  try {
    await captureScreenshots(browser);
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

