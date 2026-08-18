import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, expect } = require('../grafana-anomaly-detector-panel/node_modules/@playwright/test');

const baseUrl = process.env.GRAFANA_URL || 'http://127.0.0.1:3000';
const username = process.env.GRAFANA_USER || 'admin';
const password = process.env.GRAFANA_PASSWORD || 'admin';
const executablePath =
  process.env.BROWSER_EXECUTABLE_PATH ||
  [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => existsSync(candidate));

if (!executablePath) {
  throw new Error('No Chrome or Edge executable found. Set BROWSER_EXECUTABLE_PATH.');
}

const dashboardPath = '/d/plugin-source-matrix/grafana-anomaly-plugin-source-matrix?orgId=1&from=now-30m&to=now';
const artifactDir = join(process.cwd(), 'test-results');
mkdirSync(artifactDir, { recursive: true });

const panels = [
  {
    title: 'Prometheus source -> Prometheus metrics',
    targetLabel: 'Prometheus metrics (PromQL)',
    queryLanguage: 'PromQL',
    queryIncludes: ['grafana_anomaly_rule_score', 'feed_source="plugin"'],
  },
  {
    title: 'Loki source -> Loki sink',
    targetLabel: 'Loki (LogQL)',
    queryLanguage: 'LogQL',
    queryIncludes: ['record_type="rule"', 'unwrap normalized_score'],
    queryExcludes: ['| json | unwrap normalized_score'],
  },
  {
    title: 'InfluxDB source -> InfluxDB sink',
    targetLabel: 'InfluxDB (Flux)',
    queryLanguage: 'Flux',
    queryIncludes: ['from(bucket: "anomaly")', 'r.record_type == "rule"'],
    queryExcludes: ['grafana_anomaly_rule_score'],
  },
  {
    title: 'PostgreSQL source -> Elasticsearch sink',
    targetLabel: 'Elasticsearch (Elasticsearch)',
    queryLanguage: 'Elasticsearch',
    queryIncludes: ['"index":"grafana-anomaly-*"', 'record_type:rule'],
    queryExcludes: ['grafana_anomaly_rule_score'],
  },
  {
    title: 'ClickHouse source -> ClickHouse sink',
    targetLabel: 'ClickHouse (SQL)',
    queryLanguage: 'SQL',
    queryIncludes: ['FROM default.grafana_anomaly_scores', "record_type = 'rule'"],
    queryExcludes: ['grafana_anomaly_rule_score'],
  },
  {
    title: 'Elasticsearch source -> PostgreSQL sink',
    targetLabel: 'PostgreSQL (SQL)',
    queryLanguage: 'SQL',
    queryIncludes: ['FROM grafana_anomaly_scores', "record_type = 'rule'"],
    queryExcludes: ['grafana_anomaly_rule_score'],
  },
];

const browser = await chromium.launch({
  executablePath,
  headless: true,
});

const context = await browser.newContext({
  viewport: { width: 1600, height: 1200 },
});
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });

const page = await context.newPage();
page.setDefaultTimeout(20000);
page.setDefaultNavigationTimeout(30000);
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') {
    consoleErrors.push(message.text());
  }
});

async function loginIfNeeded() {
  const apiLogin = await context.request.post(`${baseUrl}/login`, {
    data: {
      user: username,
      password,
    },
  });
  if (!apiLogin.ok()) {
    throw new Error(`Grafana API login failed with HTTP ${apiLogin.status()}: ${await apiLogin.text()}`);
  }

  await page.goto(`${baseUrl}${dashboardPath}`, { waitUntil: 'domcontentloaded' });
  const loginButton = page.getByRole('button', { name: 'Log in' });
  const needsLogin = await loginButton
    .waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (!needsLogin) {
    return;
  }

  await page.getByPlaceholder('email or username').fill(username);
  await page.getByPlaceholder('password').fill(password);
  await loginButton.click();
  await page.waitForLoadState('domcontentloaded');
  await page.goto(`${baseUrl}${dashboardPath}`, { waitUntil: 'domcontentloaded' });
}

async function clickCopyButton(button, successText) {
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText(successText, { exact: false }).first()).toBeVisible({ timeout: 10000 });
}

async function expectPanelText(panel, fragment) {
  await expect
    .poll(async () => await panel.innerText(), {
      timeout: 60000,
      message: `panel text should include ${fragment}`,
    })
    .toContain(fragment);
}

async function expectPanelTextNotContains(panel, fragment) {
  await expect
    .poll(async () => await panel.innerText(), {
      timeout: 10000,
      message: `panel text should not include ${fragment}`,
    })
    .not.toContain(fragment);
}

async function verifyPanel(expected) {
  console.log(`[CHECK] ${expected.title}`);
  const result = {
    title: expected.title,
    incidentDetails: false,
    annotationButtons: false,
    scoreFeedSync: false,
    syncedRuleQuery: false,
    copyButtons: false,
    alertExport: false,
  };

  const panel = page.getByRole('region', { name: expected.title }).first();
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toBeVisible({ timeout: 60000 });
  await expect(panel.getByText(expected.title, { exact: true }).first()).toBeVisible({ timeout: 60000 });
  console.log(`[OK] ${expected.title}: panel visible`);

  const incident = panel.getByRole('button', { name: /Detected incident / }).first();
  await expect(incident).toBeVisible({ timeout: 60000 });
  await incident.click();
  await expect(panel.getByText('Anomaly inspector', { exact: true })).toBeVisible();
  await expect(panel.getByText('Detection strength', { exact: true })).toBeVisible();
  result.incidentDetails = true;
  console.log(`[OK] ${expected.title}: incident details visible`);

  await expect(panel.getByRole('button', { name: 'Copy annotation JSON' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Create annotation' })).toBeVisible();
  result.annotationButtons = true;
  console.log(`[OK] ${expected.title}: annotation buttons visible`);

  await panel.getByRole('button', { name: 'Sync score feed' }).click();
  await expect(panel.getByText(/Published \d+ plugin-computed score series/)).toBeVisible({ timeout: 60000 });
  result.scoreFeedSync = true;
  console.log(`[OK] ${expected.title}: score feed sync`);

  const syncedRulesToggle = panel.getByRole('button', { name: 'Show synced rules' });
  if (await syncedRulesToggle.isVisible()) {
    await syncedRulesToggle.click();
  }

  await expect(panel.getByText(`Alert rule query - ${expected.targetLabel}`).first()).toBeVisible({ timeout: 60000 });
  for (const fragment of expected.queryIncludes) {
    await expectPanelText(panel, fragment);
  }
  for (const fragment of expected.queryExcludes || []) {
    await expectPanelTextNotContains(panel, fragment);
  }
  result.syncedRuleQuery = true;
  console.log(`[OK] ${expected.title}: synced rule query is ${expected.queryLanguage}`);

  await clickCopyButton(panel.getByRole('button', { name: 'Copy alert query' }).first(), 'Copied alert query');
  await clickCopyButton(panel.getByRole('button', { name: 'Copy series query' }).first(), 'Copied per-series query');
  result.copyButtons = true;
  console.log(`[OK] ${expected.title}: copy buttons`);

  const showExports = panel.getByRole('button', { name: 'Show exports' });
  if (await showExports.isVisible()) {
    await showExports.click();
  }
  await expect(panel.getByText('Annotation export', { exact: true })).toBeVisible();
  await expect(panel.getByText('Alert rule export', { exact: true })).toBeVisible();
  await expect(panel.getByText(`Paste this ${expected.queryLanguage} into Grafana Alerting`, { exact: false })).toBeVisible();
  for (const fragment of expected.queryIncludes) {
    await expectPanelText(panel, fragment);
  }
  await expect(panel.getByRole('button', { name: 'Copy JSON' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Copy query' })).toBeVisible();
  result.alertExport = true;
  console.log(`[OK] ${expected.title}: alert export`);

  return result;
}

try {
  await loginIfNeeded();
  await expect(page.getByText('Grafana Anomaly Plugin Source Matrix', { exact: true })).toBeVisible({ timeout: 60000 });

  const results = [];
  for (const panel of panels) {
    results.push(await verifyPanel(panel));
  }

  await page.screenshot({ path: join(artifactDir, 'multi-sink-panel-buttons.png'), fullPage: true });
  console.log(JSON.stringify({ ok: true, baseUrl, executablePath, results, consoleErrors }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(artifactDir, 'multi-sink-panel-buttons-failure.png'), fullPage: true }).catch(() => undefined);
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), consoleErrors }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
