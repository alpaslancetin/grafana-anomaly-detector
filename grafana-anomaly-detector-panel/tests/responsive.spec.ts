import { test, expect, type Locator, type Page } from '@playwright/test';
import { cleanupIncidentFixture, installIncidentFixture } from './incident_fixture';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120000);
test.afterEach(async ({ page }) => cleanupIncidentFixture(page));

test('chart-only panel fits small containers and keeps SVG text unscaled after delayed data', async ({ page }, testInfo) => {
  await installIncidentFixture(page);
  await page.route(/\/(?:api\/dashboards\/uid\/plugin-source-matrix|apis\/dashboard\.grafana\.app\/.*\/dashboards\/plugin-source-matrix\/dto)(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const payload = await response.json();
    const dashboard = payload.dashboard ?? payload.spec;
    for (const panel of dashboard.panels) {
      panel.options = { ...panel.options, scoreFeedMode: 'off', showInitialLabels: false,
        showStatistics: false, showInspector: false, showAnomalyFeed: false,
        showSeriesSummary: false, showScoreFeed: false, showDetectionProfile: false,
        showExports: false, showMainChart: true, showInlineSeriesLabels: false };
    }
    await route.fulfill({ response, json: payload });
  });
  // Route handlers run newest first; delay only arrival, then use the data fixture.
  await page.route('**/api/ds/query*', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fallback();
  });
  await page.setViewportSize({ width: 400, height: 260 });
  await page.goto('/d-solo/plugin-source-matrix/grafana-anomaly-plugin-source-matrix?panelId=2&from=now-30m&to=now');
  const chart = page.getByRole('img', { name: 'Anomaly chart', exact: true });
  await expect(chart).toBeVisible({ timeout: 60000 });
  for (const size of [{ width: 400, height: 260 }, { width: 320, height: 200 }, { width: 600, height: 320 }, { width: 1200, height: 700 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => chart.evaluate(svg => {
      const element = svg as SVGSVGElement;
      const box = element.getBoundingClientRect();
      const view = element.viewBox.baseVal;
      return Math.max(Math.abs(box.width - view.width), Math.abs(box.height - view.height));
    }), { timeout: 10000 }).toBeLessThanOrEqual(2);
    const box = (await chart.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(size.height + 2);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 2);
    const axesDoNotOverlap = await chart.evaluate(svg => {
      const labels = [...svg.querySelectorAll('[data-axis]')].map(element => element.getBoundingClientRect());
      return labels.length > 1 && labels.every((a, i) => labels.slice(i + 1).every(b =>
        a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
    });
    expect(axesDoNotOverlap, 'time ticks and axis caption must not overlap').toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`chart-only-${size.width}x${size.height}.png`) });
  }
});

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
