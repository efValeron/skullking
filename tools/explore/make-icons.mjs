// Renders public/icons/icon.svg to the PNG sizes the PWA manifest needs. Usage: node make-icons.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../../public/icons/', import.meta.url));
const svg = readFileSync(dir + 'icon.svg', 'utf8');
const browser = await chromium.launch();
for (const size of [192, 512, 180]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  await page.screenshot({ path: dir + name, omitBackground: false });
  console.log(name);
  await page.close();
}
await browser.close();
