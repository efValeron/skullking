// node pixels.mjs file.png x,y x,y ... — hex colors at device-pixel coords
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [file, ...pts] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage();
const out = await p.evaluate(async ([src, pts]) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return pts.map((s) => {
    const [x, y] = s.split(',').map(Number);
    const d = g.getImageData(x, y, 1, 1).data;
    return `${s} #${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  });
}, [`data:image/png;base64,${readFileSync(file).toString('base64')}`, pts]);
console.log(out.join('\n'));
await b.close();
