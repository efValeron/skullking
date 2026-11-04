// Compares reference/clone/*.png with reference/screens/*.png (same names, 780×1688).
// Writes reference/compare/<name>.png = [original | clone | diff] at half size, prints mismatch %.
// Usage: node compare.mjs [prefix ...]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const dir = (p) => fileURLToPath(new URL(`../../reference/${p}/`, import.meta.url));
const [REF, CLONE, OUT] = [dir('screens'), dir('clone'), dir('compare')];
mkdirSync(OUT, { recursive: true });
const prefixes = process.argv.slice(2);

/** Half-size copy (2×2 average) of `src` into `dst` at column offset `ox`. */
function blitHalf(src, dst, ox) {
  for (let y = 0; y < dst.height; y++)
    for (let x = 0; x < src.width / 2; x++)
      for (let c = 0; c < 4; c++) {
        const at = (sx, sy) => src.data[(sy * src.width + sx) * 4 + c];
        const v = (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4;
        dst.data[(y * dst.width + ox + x) * 4 + c] = v;
      }
}

const rows = [];
for (const f of readdirSync(CLONE).filter((f) => f.endsWith('.png')).sort()) {
  if (prefixes.length && !prefixes.some((p) => f.startsWith(p))) continue;
  if (!existsSync(REF + f)) continue;
  const a = PNG.sync.read(readFileSync(REF + f));
  const b = PNG.sync.read(readFileSync(CLONE + f));
  if (a.width !== b.width || a.height !== b.height) {
    rows.push([f, 'size mismatch']);
    continue;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.2, alpha: 0.3 });
  const out = new PNG({ width: (a.width / 2) * 3, height: a.height / 2 });
  [a, b, diff].forEach((img, i) => blitHalf(img, out, (a.width / 2) * i));
  writeFileSync(OUT + f, PNG.sync.write(out));
  rows.push([f, ((n / (a.width * a.height)) * 100).toFixed(1) + '%']);
}
for (const [f, v] of rows) console.log(v.padStart(14), f);
