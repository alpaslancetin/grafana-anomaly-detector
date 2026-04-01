import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const screenshotDir = path.join(repoRoot, 'benchmarks', 'presentation', 'assets', 'screenshots');
const scenarioDir = path.join(
  repoRoot,
  'benchmarks',
  'elastic_side_by_side',
  'outputs',
  'labeled_scenarios'
);

const grafanaBaseUrl = process.env.GRAFANA_URL ?? 'http://localhost:3300';
const grafanaUser = process.env.GRAFANA_USER ?? 'admin';
const grafanaPassword = process.env.GRAFANA_PASSWORD ?? 'admin';
const kibanaBaseUrl = process.env.KIBANA_URL ?? 'http://localhost:5601';

const scenarios = [
  {
    id: 'latency_spike_mad',
    metricPreset: 'latency',
    panelTitle: 'Latency spike benchmark',
    dashboardUid: 'benchmark-latency-real',
    grafanaShot: 'grafana-latency-real.png',
    elasticShot: 'elastic-latency-real.png',
  },
  {
    id: 'subtle_level_shift',
    metricPreset: 'level_shift',
    panelTitle: 'Level shift benchmark',
    dashboardUid: 'benchmark-levelshift-real',
    grafanaShot: 'grafana-levelshift-real.png',
    elasticShot: 'elastic-levelshift-real.png',
  },
];

function basicAuthHeaders(user, password) {
  const token = Buffer.from(`${user}:${password}`).toString('base64');
  return {
    Authorization: `Basic ${token}`,
    'Content-Type': 'application/json',
  };
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function readScenarioRows(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function buildRawFrameContent(rows) {
  const metricLabel = rows[0]?.metric_name ?? 'metric_value';
  return JSON.stringify(
    [
      {
        columns: [
          { text: 'Time', type: 'time' },
          { text: metricLabel, type: 'number' },
        ],
        rows: rows.map((row) => [row.timestamp_epoch_ms, row.metric_value]),
      },
    ],
    null,
    2
  );
}

async function upsertGrafanaDashboard(scenario) {
  const rows = await readScenarioRows(path.join(scenarioDir, `${scenario.id}.ndjson`));
  const fromMs = rows[0].timestamp_epoch_ms;
  const toMs = rows[rows.length - 1].timestamp_epoch_ms;
  const rawFrameContent = buildRawFrameContent(rows);

  const payload = {
    dashboard: {
      id: null,
      uid: scenario.dashboardUid,
      title: scenario.panelTitle,
      tags: ['benchmark', 'real-ui', scenario.id],
      timezone: 'browser',
      schemaVersion: 39,
      version: 0,
      editable: true,
      refresh: '',
      time: {
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
      },
      panels: [
        {
          id: 1,
          title: scenario.panelTitle,
          type: 'alpas-anomalydetector-panel',
          datasource: {
            type: 'grafana-testdata-datasource',
            uid: 'anomaly-demo-testdata',
          },
          gridPos: { h: 12, w: 24, x: 0, y: 0 },
          options: {
            title: scenario.panelTitle,
            setupMode: 'recommended',
            metricPreset: scenario.metricPreset,
            detectionMode: 'single',
            algorithm: 'zscore',
            sensitivity: 4.5,
            baselineWindow: 24,
            seasonalitySamples: 8,
            seasonalRefinement: 'cycle',
            severityPreset: 'balanced',
            bucketSpan: 'raw',
            maxAnomalies: 8,
            showBands: true,
            showExpectedLine: true,
            showSummary: false,
            showExports: false,
            showInlineSeriesLabels: true,
            showFocusBand: false,
            timeAxisDensity: 'balanced',
            timeAxisPlacement: 'bottom',
            markerShapeMode: 'severity',
            scoreFeedMode: 'off',
            scoreFeedEndpoint: '',
            scoreFeedRuleNamePrefix: '',
          },
          targets: [
            {
              datasource: {
                type: 'grafana-testdata-datasource',
                uid: 'anomaly-demo-testdata',
              },
              refId: 'A',
              scenarioId: 'raw_frame',
              rawFrameContent,
            },
          ],
        },
      ],
    },
    folderId: 0,
    overwrite: true,
  };

  const response = await fetch(`${grafanaBaseUrl}/api/dashboards/db`, {
    method: 'POST',
    headers: basicAuthHeaders(grafanaUser, grafanaPassword),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Grafana dashboard create failed for ${scenario.id}: ${response.status} ${await response.text()}`);
  }

  const body = await response.json();
  return {
    url: body.url,
    fromMs,
    toMs,
  };
}

async function loginGrafana(page) {
  await page.goto(`${grafanaBaseUrl}/login`, { waitUntil: 'domcontentloaded' });
  const username = page.locator('input[name="user"]');
  if (!(await username.isVisible().catch(() => false))) {
    return;
  }

  await username.fill(grafanaUser);
  await page.locator('input[name="password"]').fill(grafanaPassword);
  await page.getByRole('button', { name: /log in|sign in/i }).first().click();
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
}

async function captureGrafanaScenario(page, scenario) {
  const dashboard = await upsertGrafanaDashboard(scenario);
  const separator = dashboard.url.includes('?') ? '&' : '?';
  const targetUrl = `${grafanaBaseUrl}${dashboard.url}${separator}orgId=1&viewPanel=1&from=${dashboard.fromMs}&to=${dashboard.toMs}`;

  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 120000 }).catch(async () => {
    await page.waitForTimeout(8000);
  });
  await page.waitForTimeout(3000);

  const chart = page.locator('svg[aria-label="Anomaly chart"]').first();
  await chart.waitFor({ timeout: 60000 });
  const panel = chart.locator('xpath=ancestor::section[contains(@class,"panel-container")][1]');
  const panelBox = await panel.boundingBox();
  const chartBox = await chart.boundingBox();

  if (!panelBox || !chartBox) {
    throw new Error(`Grafana panel bounding box failed for ${scenario.id}`);
  }

  const clip = {
    x: Math.max(0, panelBox.x),
    y: Math.max(0, panelBox.y),
    width: panelBox.width,
    height: Math.min(panelBox.height, chartBox.y + chartBox.height - panelBox.y + 64),
  };

  await page.screenshot({
    path: path.join(screenshotDir, scenario.grafanaShot),
    clip,
  });
}

async function captureElasticScenario(page, scenario) {
  const rows = await readScenarioRows(path.join(scenarioDir, `${scenario.id}.ndjson`));
  await page.goto(`${kibanaBaseUrl}/app/ml/timeseriesexplorer`, {
    waitUntil: 'networkidle',
    timeout: 120000,
  }).catch(async () => {
    await page.waitForTimeout(12000);
  });
  await page.waitForTimeout(4000);

  const radio = page.locator(`[data-test-subj="benchmark-${scenario.id}-radio-button"]`).first();
  await radio.waitFor({ timeout: 60000 });
  await radio.click({ force: true });
  await page.waitForTimeout(700);

  const apply = page.locator('[data-test-subj="mlFlyoutJobSelectorButtonApply"]').first();
  await apply.waitFor({ timeout: 30000 });
  await apply.click({ force: true });
  await page.waitForTimeout(12000);

  const pagePanel = page.locator('[data-test-subj="mlPageSingleMetricViewer"]').first();
  const anomaliesTable = page.locator('[data-test-subj="mlAnomaliesTable"]').first();
  await pagePanel.waitFor({ timeout: 60000 });
  await anomaliesTable.waitFor({ timeout: 60000 });

  const pageBox = await pagePanel.boundingBox();
  const tableBox = await anomaliesTable.boundingBox();

  if (!pageBox || !tableBox) {
    throw new Error(`Elastic single metric viewer bounding box failed for ${scenario.id}`);
  }

  const clip = {
    x: Math.max(0, pageBox.x - 8),
    y: Math.max(0, pageBox.y - 8),
    width: Math.min(page.viewportSize()?.width ?? 1680, pageBox.x + pageBox.width + 8) - Math.max(0, pageBox.x - 8),
    height: Math.max(tableBox.y + tableBox.height - pageBox.y + 16, 320),
  };

  await page.screenshot({
    path: path.join(screenshotDir, scenario.elasticShot),
    clip,
  });
}

async function main() {
  await ensureDir(screenshotDir);
  const browser = await chromium.launch({ headless: true });
  const grafanaPage = await browser.newPage({
    viewport: { width: 1680, height: 1200 },
    deviceScaleFactor: 1.25,
  });
  const kibanaPage = await browser.newPage({
    viewport: { width: 1680, height: 1280 },
    deviceScaleFactor: 1.25,
  });

  try {
    await loginGrafana(grafanaPage);

    for (const scenario of scenarios) {
      await captureGrafanaScenario(grafanaPage, scenario);
      await captureElasticScenario(kibanaPage, scenario);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
