// Génère les icônes PNG de l'application à partir de public/icons/icon.svg (navigateur sans interface).
// Usage : npm run icons
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [size, file, pad] of [[192, 'icon-192.png', 0], [512, 'icon-512.png', 0], [512, 'icon-maskable-512.png', 0.1]]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(`<html><body style="margin:0;background:#0d1110;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body></html>`);
  await page.screenshot({ path: new URL(`../public/icons/${file}`, import.meta.url).pathname });
}
await browser.close();
console.log('Icônes générées.');
