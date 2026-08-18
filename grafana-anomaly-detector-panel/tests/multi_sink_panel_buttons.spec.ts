import { expect, test, type Locator, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

interface PanelExpectation {
  title: string;
  targetLabel: string;
  queryLanguage: string;
  queryIncludes: string[];
  queryExcludes?: string[];
}

const dashboardPath = '/d/plugin-source-matrix/grafana-anomaly-plugin-source-matrix?orgId=1&from=now-30m&to=now';

const panels: PanelExpectation[] = [
  {
    title: 'Prometheus source -> Prometheus metrics',
    targetLabel: 'Prometheus metrics (PromQL)',
    queryLanguage: 'PromQL',
    queryIncludes: ['grafana_anomaly_rule_score', 'rule="local_prometheus_source_prometheus_metrics"'],
    queryExcludes: ['feed_source='],
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

async function gotoDashboard(page: Page) {
  await page.goto(dashboardPath, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Grafana Anomaly Plugin Source Matrix', { exact: true })).toBeVisible({ timeout: 60000 });
}

async function visiblePanel(page: Page, title: string): Promise<Locator> {
  const panel = page.getByRole('region', { name: title }).first();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if ((await panel.count()) > 0) {
      break;
    }
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(500);
  }
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toBeVisible({ timeout: 60000 });
  await expect(panel.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 60000 });
  await expect(panel.getByRole('heading', { name: 'Anomaly Detector' })).toBeVisible({ timeout: 60000 });
  await expect(panel.getByRole('status')).toBeVisible({ timeout: 60000 });
  return panel;
}

async function clickFirstIncidentIfPresent(panel: Locator): Promise<boolean> {
  const incident = panel.getByRole('button', { name: /Detected incident / }).first();
  const hasIncident = await incident
    .waitFor({ state: 'visible', timeout: 30000 })
    .then(() => true)
    .catch(() => false);

  if (!hasIncident) {
    await expect(panel.getByText(/No operationally relevant incidents|No clustered incidents/).first()).toBeVisible({ timeout: 60000 });
    await expect(panel.locator('[aria-label="Anomaly inspector"]').first().getByText('Select a detected incident')).toBeVisible({ timeout: 60000 });
    return false;
  }

  await incident.click();
  await expect(panel.locator('[aria-label="Detected incident overview"]').first()).toBeVisible();
  const inspector = panel.locator('[aria-label="Anomaly inspector"]').first();
  await expect(inspector.getByText('Anomaly inspector', { exact: true })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Open alert rule builder' })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Copy rule labels' })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Create annotation' })).toBeVisible();
  await expect(inspector.getByRole('button', { name: 'Copy alert query' })).toBeVisible();
  await expect(panel.getByText('Why is this anomalous?', { exact: true })).toBeVisible();
  await expect(panel.getByText('Deviation', { exact: true })).toBeVisible();

  const createAnnotation = inspector.getByRole('button', { name: 'Create annotation' });
  await expect(createAnnotation).toBeEnabled();
  await createAnnotation.click();
  await expect(panel.getByText('Created a Grafana annotation for the selected anomaly.')).toBeVisible({ timeout: 30000 });
  return true;
}

async function syncAndOpenRules(panel: Locator, expected: PanelExpectation, hasIncident: boolean) {
  const syncButton = panel.getByRole('button', { name: 'Sync score feed' });
  await expect(syncButton).toBeVisible({ timeout: 60000 });
  await syncButton.click();
  await expect(panel.getByText(/Published \d+ plugin-computed score series/)).toBeVisible({ timeout: 60000 });

  const showRules = panel.getByRole('button', { name: 'Show synced rules' });
  await expect(showRules).toBeVisible({ timeout: 60000 });
  await showRules.click();

  await expect(panel.getByText('Alert rule query', { exact: true }).first()).toBeVisible({ timeout: 60000 });
  await expect(panel.getByText(expected.queryLanguage, { exact: true }).first()).toBeVisible({ timeout: 60000 });
  for (const fragment of expected.queryIncludes) {
    await expect
      .poll(async () => {
        const visibleText = await panel.evaluate((element) => (element as HTMLElement).innerText);
        return visibleText.includes(fragment);
      }, { timeout: 60000 })
      .toBe(true);
  }
  for (const fragment of expected.queryExcludes ?? []) {
    await expect
      .poll(async () => {
        const visibleText = await panel.evaluate((element) => (element as HTMLElement).innerText);
        return visibleText.includes(fragment);
      }, { timeout: 10000 })
      .toBe(false);
  }

  const copyAlertQuery = panel.getByRole('button', { name: 'Copy alert query' }).first();
  await expect(copyAlertQuery).toBeVisible();
  await expect(copyAlertQuery).toBeEnabled();
  await copyAlertQuery.click();
  await expect
    .poll(async () => panel.page().evaluate(() => navigator.clipboard.readText()), { timeout: 30000 })
    .toContain(expected.queryIncludes[0]);

  if (!hasIncident) {
    return;
  }

  const inspector = panel.locator('[aria-label="Anomaly inspector"]').first();
  const popupPromise = panel.page().waitForEvent('popup');
  await expect(inspector.getByRole('button', { name: 'Open alert rule builder' })).toBeEnabled();
  await inspector.getByRole('button', { name: 'Open alert rule builder' }).click();
  const alertBuilder = await popupPromise;
  await expect(alertBuilder).toHaveURL(/\/alerting\/new/);
  await expect(alertBuilder).toHaveURL(/label_alert_family=anomaly_detector/);
  await expect(alertBuilder).toHaveURL(/label_severity=major/);
  const alertBuilderUrl = new URL(alertBuilder.url());
  expect(alertBuilderUrl.searchParams.get('ruleName')).toContain(expected.title);
  expect(alertBuilderUrl.searchParams.get('query')).toBeTruthy();
  await expect
    .poll(async () => panel.page().evaluate(() => navigator.clipboard.readText()), { timeout: 30000 })
    .toBe(alertBuilderUrl.searchParams.get('query'));
  await alertBuilder.close();

  await expect(inspector.getByRole('button', { name: 'Copy rule labels' })).toBeEnabled();
  await inspector.getByRole('button', { name: 'Copy rule labels' }).click();
  await expect(panel.getByText('Copied suggested alert labels.')).toBeVisible({ timeout: 30000 });

  await expect(inspector.getByRole('button', { name: 'Copy alert query' })).toBeEnabled();
  await inspector.getByRole('button', { name: 'Copy alert query' }).click();
  await expect(panel.getByText('Copied the alert query for Grafana Alerting.')).toBeVisible({ timeout: 30000 });
}

async function verifyAutomationHandoffDefault(panel: Locator, expected: PanelExpectation) {
  await expect(panel.getByText('Alerting & automation', { exact: true })).not.toBeVisible();
  await expect(panel.getByText('Alert rule export', { exact: true })).not.toBeVisible();
  for (const fragment of expected.queryIncludes) {
    await expect
      .poll(async () => {
        const visibleText = await panel.evaluate((element) => (element as HTMLElement).innerText);
        return visibleText.includes(fragment);
      }, { timeout: 60000 })
      .toBe(true);
  }
}

test('all multi-sink demo panel buttons and target-specific alert queries work', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await gotoDashboard(page);

  let panelsWithIncidents = 0;
  for (const expected of panels) {
    const panel = await visiblePanel(page, expected.title);
    const hasIncident = await clickFirstIncidentIfPresent(panel);
    if (hasIncident) {
      panelsWithIncidents += 1;
    }
    await syncAndOpenRules(panel, expected, hasIncident);
    await verifyAutomationHandoffDefault(panel, expected);
  }

  expect(panelsWithIncidents).toBeGreaterThan(0);

  const rulesResponse = await page.request.get('http://127.0.0.1:9110/api/sync/rules');
  expect(rulesResponse.ok()).toBe(true);
  const rulesPayload = (await rulesResponse.json()) as { rules: Array<{ rule: string; query: string }> };
  expect(rulesPayload.rules).toHaveLength(panels.length);
  for (const rule of rulesPayload.rules) {
    expect(rule.query).toContain('checkout_');
    expect(rule.query).not.toContain(rule.rule);
  }
});
