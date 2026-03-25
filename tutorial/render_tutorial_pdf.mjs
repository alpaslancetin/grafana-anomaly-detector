import { createRequire } from 'node:module';
const require = createRequire('C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/alpas-anomalydetector-panel/package.json');
const { chromium } = require('playwright');
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const htmlPath = 'C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/tutorial/Anomaly_Detector_End_to_End_TR.html';
const pdfPath = 'C:/Users/alpas/Documents/CodexSample/grafana-anomaly-lab/tutorial/Anomaly_Detector_End_to_End_TR.pdf';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
await page.waitForTimeout(2500);
await page.pdf({
  path: pdfPath,
  format: 'A4',
  printBackground: true,
  margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
  preferCSSPageSize: true,
});
await browser.close();
console.log(pdfPath);
