// Persistent Playwright session for exploring the original app step by step (phone browser).
// Start: sh restart.sh [locale]   then: sh d.sh '{"op":"texts"}'
// Ops: open{locale} reload texts tap{x,y|text,nth} type{text} key{key} shot{name,clip} eval{js} wait{ms} storage scroll{x,y,dy}
import { chromium, devices } from 'playwright';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const SCREENS = fileURLToPath(new URL('../../reference/screens/', import.meta.url));
const APP = process.env.APP_URL ?? 'https://skullkingkraken.github.io/skullkingkrakenapp/';
const PORT = Number(process.env.PORT ?? 9333);
const [W, H] = (process.env.VIEWPORT ?? '390x844').split('x').map(Number);

const browser = await chromium.launch();
let ctx, page;

// Phone UA -> Flutter HTML renderer: text is in DOM as flt-paragraph. Semantics nodes are read too when enabled.
const texts = () =>
  page.evaluate(() => {
    const roots = [document, document.querySelector('flt-glass-pane')?.shadowRoot].filter(Boolean);
    const out = [];
    const visible = (b) => b.width > 0 && b.x < innerWidth && b.y < innerHeight && b.x + b.width > 0 && b.y + b.height > 0;
    for (const root of roots) {
      for (const p of root.querySelectorAll('flt-paragraph')) {
        const t = p.textContent.trim();
        const r = document.createRange();
        r.selectNodeContents(p);
        const b = r.getBoundingClientRect();
        if (t && visible(b)) out.push({ t, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), flags: 'p' });
      }
      for (const e of root.querySelectorAll('flt-semantics')) {
        const label = e.getAttribute('aria-label') ?? (e.childElementCount ? '' : e.textContent);
        const input = e.querySelector('input,textarea');
        const t = (label || input?.value || '').trim();
        if (!t) continue;
        const b = e.getBoundingClientRect();
        if (!visible(b)) continue;
        const flags = [e.getAttribute('role'), e.getAttribute('aria-disabled') === 'true' && 'disabled', e.getAttribute('aria-checked') && `checked=${e.getAttribute('aria-checked')}`]
          .filter(Boolean)
          .join(' ');
        out.push({ t, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), flags });
      }
    }
    return out;
  });

const settle = (ms = 700) => page.waitForTimeout(ms);

const enableSemantics = () =>
  page.evaluate(() => {
    const ph = document.querySelector('flt-glass-pane')?.shadowRoot?.querySelector('flt-semantics-placeholder') ?? document.querySelector('flt-semantics-placeholder');
    if (!ph) return;
    // Mobile enabler checks the click point lies inside the placeholder.
    const b = ph.getBoundingClientRect();
    const o = { bubbles: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
    for (const t of ['pointerdown', 'pointerup']) ph.dispatchEvent(new PointerEvent(t, o));
    ph.dispatchEvent(new MouseEvent('click', o));
  });

async function open(locale = 'ru-RU') {
  await ctx?.close();
  ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    userAgent: devices['Pixel 7'].userAgent,
    locale,
    serviceWorkers: 'block',
  });
  page = await ctx.newPage();
  await page.goto(APP);
  await page.waitForFunction(() => document.querySelector('flt-glass-pane')?.shadowRoot?.querySelector('flt-semantics-placeholder, canvas'), null, { timeout: 60000 });
  await settle(2500);
  await enableSemantics();
  await settle(800);
}

async function tap({ x, y, text, nth = 0 }) {
  if (text !== undefined) {
    const hits = (await texts()).filter((p) => p.t === text);
    const h = hits[nth];
    if (!h) throw new Error(`no text "${text}" (found ${hits.length})`);
    x = h.x + h.w / 2;
    y = h.y + h.h / 2;
  }
  await page.touchscreen.tap(x, y);
  await settle();
  return { tapped: [Math.round(x), Math.round(y)], texts: (await texts()).map((p) => `${p.t} @${p.x},${p.y} ${p.w}x${p.h} ${p.flags}`) };
}

const ops = {
  open: async (a) => (await open(a.locale), { texts: await texts() }),
  reload: async () => (await page.reload(), await settle(3000), await enableSemantics(), await settle(800), { texts: await texts() }),
  texts: async (a) => (a.full ? texts() : (await texts()).map((p) => `${p.t} @${p.x},${p.y} ${p.w}x${p.h} ${p.flags}`)),
  tap,
  type: async (a) => (await page.keyboard.type(a.text, { delay: 30 }), await settle(), { texts: (await texts()).map((p) => p.t) }),
  key: async (a) => (await page.keyboard.press(a.key), await settle(), { ok: true }),
  scroll: async (a) => (await page.mouse.move(a.x ?? W / 2, a.y ?? H / 2), await page.mouse.wheel(0, a.dy ?? 300), await settle(), { ok: true }),
  shot: async (a) => {
    const path = `${SCREENS}${a.name}.png`;
    await page.screenshot({ path, clip: a.clip && { x: a.clip[0], y: a.clip[1], width: a.clip[2], height: a.clip[3] } });
    return { path };
  },
  eval: async (a) => page.evaluate(a.js),
  wait: async (a) => (await settle(a.ms ?? 1000), { ok: true }),
  storage: async () => page.evaluate(() => ({ ...localStorage })),
  // Distinct text styles and filled shapes (HTML renderer exposes them as DOM).
  styles: async () =>
    page.evaluate(() => {
      const root = document.querySelector('flt-glass-pane').shadowRoot;
      const txt = {};
      for (const s of root.querySelectorAll('flt-span')) {
        const c = getComputedStyle(s);
        const k = `${c.fontWeight} ${c.fontSize} ${c.color} ls=${c.letterSpacing}`;
        (txt[k] ??= new Set()).add(s.textContent.trim().slice(0, 25));
      }
      const shapes = {};
      for (const e of root.querySelectorAll('draw-rrect, draw-rect, draw-circle')) {
        const c = getComputedStyle(e);
        const k = `${e.tagName} bg=${c.backgroundColor} r=${c.borderRadius} border=${c.border} ${e.style.width}x${e.style.height}`;
        shapes[k] = (shapes[k] ?? 0) + 1;
      }
      return { text: Object.fromEntries(Object.entries(txt).map(([k, v]) => [k, [...v].filter(Boolean).slice(0, 6)])), shapes };
    }),
  // Frames right after a tap, to see the transition type.
  frames: async (a) => {
    await page.touchscreen.tap(a.x, a.y);
    const out = [];
    for (let i = 0; i < (a.n ?? 5); i++) {
      const path = `${SCREENS}${a.name}-f${i}.jpg`;
      await page.screenshot({ path, scale: 'css', type: 'jpeg', quality: 40 });
      out.push(path);
    }
    await settle();
    return out;
  },
};

await open(process.env.LOCALE ?? 'ru-RU');

http
  .createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    try {
      const a = JSON.parse(body || '{}');
      const fn = ops[a.op];
      if (!fn) throw new Error(`unknown op ${a.op}`);
      res.end(JSON.stringify(await fn(a), null, 1));
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e?.stack ?? e));
    }
  })
  .listen(PORT, () => console.log(`driver ready on ${PORT}`));
