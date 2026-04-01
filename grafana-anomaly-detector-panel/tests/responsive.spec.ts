import { test, expect, type Locator, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

const dashboardUid = 'prometheus-live-anomaly-demo';
const dashboardSlug = 'prometheus-live-anomaly-demo';

const scenarios = [
  {
    name: 'full-dashboard-desktop',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1`,
    viewport: { width: 1600, height: 1100 },
    expectedCharts: 2,
    heading: 'Prometheus Live Anomaly Demo',
  },
  {
    name: 'full-dashboard-laptop',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1`,
    viewport: { width: 1366, height: 768 },
    expectedCharts: 2,
    heading: 'Prometheus Live Anomaly Demo',
  },
  {
    name: 'full-dashboard-tablet',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1`,
    viewport: { width: 1024, height: 1280 },
    expectedCharts: 2,
    heading: 'Prometheus Live Anomaly Demo',
  },
  {
    name: 'full-dashboard-compact',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1`,
    viewport: { width: 820, height: 1180 },
    expectedCharts: 2,
    heading: 'Prometheus Live Anomaly Demo',
  },
  {
    name: 'view-panel-multi',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1&viewPanel=1`,
    viewport: { width: 1200, height: 900 },
    expectedCharts: 1,
    heading: 'Prometheus Live Anomaly Demo',
  },
  {
    name: 'view-panel-single-narrow',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1&viewPanel=2`,
    viewport: { width: 820, height: 960 },
    expectedCharts: 1,
    heading: 'Prometheus Live Anomaly Demo',
  },
  {
    name: 'view-panel-single-compact',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1&viewPanel=2`,
    viewport: { width: 700, height: 960 },
    expectedCharts: 1,
    heading: 'Prometheus Live Anomaly Demo',
  },
  {
    name: 'solo-panel-compact',
    path: `/d-solo/${dashboardUid}/${dashboardSlug}?orgId=1&panelId=1`,
    viewport: { width: 900, height: 700 },
    expectedCharts: 1,
  },
];

async function assertChartLooksAlive(chart: Locator) {
  await chart.scrollIntoViewIfNeeded();
  await expect(chart).toBeVisible({ timeout: 60000 });

  const box = await chart.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(260);
  expect(box!.height).toBeGreaterThan(180);

  const pathCount = await chart.locator('path').count();
  expect(pathCount).toBeGreaterThan(3);

  const labels = await chart.locator('text').allTextContents();
  expect(labels.join(' ')).toContain('TIME');
}

async function assertScenario(page: Page, scenario: (typeof scenarios)[number]) {
  await page.setViewportSize(scenario.viewport);
  await page.goto(scenario.path, { waitUntil: 'domcontentloaded' });
  if ('heading' in scenario && scenario.heading) {
    await expect(page.getByText(scenario.heading).first()).toBeVisible({ timeout: 60000 });
  }

  const charts = page.locator('svg[aria-label="Anomaly chart"]');
  await expect(charts).toHaveCount(scenario.expectedCharts, { timeout: 60000 });
  for (let index = 0; index < scenario.expectedCharts; index++) {
    await assertChartLooksAlive(charts.nth(index));
  }
}

for (const scenario of scenarios) {
  test(`responsive chart stays visible in ${scenario.name}`, async ({ page }) => {
    await assertScenario(page, scenario);
  });
}

test('view panel chart survives viewport resize and redraw', async ({ page }) => {
  const viewPath = `/d/${dashboardUid}/${dashboardSlug}?orgId=1&viewPanel=2`;

  await page.setViewportSize({ width: 1280, height: 920 });
  await page.goto(viewPath, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Prometheus Live Anomaly Demo').first()).toBeVisible({ timeout: 60000 });

  const chart = page.locator('svg[aria-label="Anomaly chart"]').first();
  await assertChartLooksAlive(chart);

  await page.setViewportSize({ width: 700, height: 960 });
  await page.waitForTimeout(800);
  await assertChartLooksAlive(chart);

  await page.setViewportSize({ width: 1200, height: 860 });
  await page.waitForTimeout(800);
  await assertChartLooksAlive(chart);
});

test('score-feed sync registers exporter rules on live dashboard', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/d/${dashboardUid}/${dashboardSlug}?orgId=1&viewPanel=1`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('button', { name: 'Sync score feed' })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Sync score feed' }).click();

  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const response = await fetch('http://127.0.0.1:9110/api/sync/rules');
        const payload = await response.json();
        const rules = Array.isArray(payload) ? payload : payload.rules;
        return Array.isArray(rules) && JSON.stringify(rules).includes('prometheus_live_anomaly_demo_panel_1');
      });
    }, { timeout: 30000 })
    .toBe(true);

  const rulesPayload = await page.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:9110/api/sync/rules');
    return response.json();
  });

  const metricsPayload = await page.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:9110/metrics');
    return response.text();
  });

  const rules = Array.isArray(rulesPayload) ? rulesPayload : rulesPayload.rules;
  expect(Array.isArray(rules)).toBeTruthy();
  expect(JSON.stringify(rules)).toContain('prometheus_live_anomaly_demo_panel_1');
  expect(metricsPayload).toContain('grafana_anomaly_rule_score');
  expect(metricsPayload).toContain('grafana_anomaly_confidence_score');
});
