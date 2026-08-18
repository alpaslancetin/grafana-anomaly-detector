import { test, expect, type Locator, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);

const dashboardUid = 'plugin-source-matrix';
const dashboardSlug = 'grafana-anomaly-plugin-source-matrix';

const scenarios = [
  {
    name: 'full-dashboard-desktop',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now`,
    viewport: { width: 1600, height: 1100 },
    expectedCharts: 2,
    heading: 'Grafana Anomaly Plugin Source Matrix',
  },
  {
    name: 'full-dashboard-laptop',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now`,
    viewport: { width: 1366, height: 768 },
    expectedCharts: 2,
    heading: 'Grafana Anomaly Plugin Source Matrix',
  },
  {
    name: 'full-dashboard-tablet',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now`,
    viewport: { width: 1024, height: 1280 },
    expectedCharts: 2,
    heading: 'Grafana Anomaly Plugin Source Matrix',
  },
  {
    name: 'full-dashboard-compact',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now`,
    viewport: { width: 820, height: 1180 },
    expectedCharts: 2,
    heading: 'Grafana Anomaly Plugin Source Matrix',
  },
  {
    name: 'view-panel-prometheus',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now&viewPanel=2`,
    viewport: { width: 1200, height: 900 },
    expectedCharts: 1,
    heading: 'Grafana Anomaly Plugin Source Matrix',
  },
  {
    name: 'view-panel-loki-narrow',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now&viewPanel=3`,
    viewport: { width: 820, height: 960 },
    expectedCharts: 1,
    heading: 'Grafana Anomaly Plugin Source Matrix',
  },
  {
    name: 'view-panel-loki-compact',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now&viewPanel=3`,
    viewport: { width: 700, height: 960 },
    expectedCharts: 1,
    heading: 'Grafana Anomaly Plugin Source Matrix',
  },
  {
    name: 'edit-panel-prometheus',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now&editPanel=2`,
    viewport: { width: 1440, height: 980 },
    expectedCharts: 1,
  },
  {
    name: 'edit-panel-prometheus-narrow',
    path: `/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now&editPanel=2`,
    viewport: { width: 1180, height: 900 },
    expectedCharts: 1,
  },
  {
    name: 'solo-panel-compact',
    path: `/d-solo/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now&panelId=2`,
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

  const chartCard = chart.locator('xpath=..');
  const chartCardBox = await chartCard.boundingBox();
  expect(chartCardBox).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(chartCardBox!.width + 2);
  expect(box!.height).toBeLessThanOrEqual(chartCardBox!.height + 2);

  const pathCount = await chart.locator('path').count();
  expect(pathCount).toBeGreaterThanOrEqual(3);

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
  await expect
    .poll(async () => charts.count(), { timeout: 60000 })
    .toBeGreaterThanOrEqual(scenario.expectedCharts);
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
  const viewPath = `/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now&viewPanel=2`;

  await page.setViewportSize({ width: 1280, height: 920 });
  await page.goto(viewPath, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Grafana Anomaly Plugin Source Matrix').first()).toBeVisible({ timeout: 60000 });

  const chart = page.locator('svg[aria-label="Anomaly chart"]').first();
  await assertChartLooksAlive(chart);

  await page.setViewportSize({ width: 700, height: 960 });
  await page.waitForTimeout(800);
  await assertChartLooksAlive(chart);

  await page.setViewportSize({ width: 1200, height: 860 });
  await page.waitForTimeout(800);
  await assertChartLooksAlive(chart);
});

test('edit panel chart survives viewport resize and redraw', async ({ page }) => {
  const editPath = `/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now&editPanel=2`;

  await page.setViewportSize({ width: 1440, height: 980 });
  await page.goto(editPath, { waitUntil: 'domcontentloaded' });

  const chart = page.locator('svg[aria-label="Anomaly chart"]').first();
  await assertChartLooksAlive(chart);

  await page.setViewportSize({ width: 1180, height: 900 });
  await page.waitForTimeout(900);
  await assertChartLooksAlive(chart);

  await page.setViewportSize({ width: 1600, height: 980 });
  await page.waitForTimeout(900);
  await assertChartLooksAlive(chart);
});

test('score-feed sync registers exporter rules on live dashboard', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/d/${dashboardUid}/${dashboardSlug}?orgId=1&from=now-30m&to=now&viewPanel=2`, { waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('button', { name: 'Sync score feed' })).toBeVisible({ timeout: 60000 });
  await page.getByRole('button', { name: 'Sync score feed' }).click();

  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const response = await fetch('http://127.0.0.1:9110/metrics');
        const payload = await response.text();
        return payload.includes('grafana_anomaly_rule_score') && payload.includes('rule="local_prometheus_source_prometheus_metrics"') && payload.includes('feed_source="grafana_panel"');
      });
    }, { timeout: 30000 })
    .toBe(true);

  const metricsPayload = await page.evaluate(async () => {
    const response = await fetch('http://127.0.0.1:9110/metrics');
    return response.text();
  });

  expect(metricsPayload).toContain('grafana_anomaly_rule_score');
  expect(metricsPayload).toContain('grafana_anomaly_confidence_score');
  expect(metricsPayload).toContain('rule="local_prometheus_source_prometheus_metrics"');
  expect(metricsPayload).toContain('feed_source="grafana_panel"');
});
