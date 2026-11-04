// node montage.mjs out.png in1.png in2.png ... — side-by-side strip (scaled to 300px height each)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [out, ...ins] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 160 * ins.length, height: 346 } });
await p.setContent(`<body style="margin:0;display:flex">${ins.map((f) => `<img style="height:346px" src="data:image/png;base64,${readFileSync(f).toString('base64')}">`).join('')}</body>`);
await p.screenshot({ path: out });
await b.close();
