// Headless browser probe: node tools/browserprobe.mjs [map] [seconds]  (needs `npx vite --port 5199` running)
// Holds W+Space+fire, spins the view and reports frame stalls, page errors and NaN state.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
const pwDir = homedir() + '/.cache/ms-playwright';
const chromeDir = existsSync(pwDir) && readdirSync(pwDir).find((d) => /^chromium-\d+$/.test(d));
const b = await chromium.launch({
  executablePath: chromeDir ? `${pwDir}/${chromeDir}/chrome-linux/chrome` : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const map = process.argv[2] || 'spire', secs = +(process.argv[3] || 40);
const p = await b.newPage({ viewport: { width: 800, height: 600 } });
const errs = new Map();
p.on('console', (m) => { if (m.type() === 'error') errs.set(m.text().slice(0, 200), (errs.get(m.text().slice(0, 200)) || 0) + 1); });
p.on('pageerror', (e) => { const k = (e.stack || e.message).slice(0, 400); errs.set(k, (errs.get(k) || 0) + 1); });
await p.goto(`http://localhost:5199/?autostart=${map}&bots=8&skill=4`);
await p.waitForFunction(() => window.__session && window.__session.running, null, { timeout: 180000 });
await p.evaluate(() => {
  const s = window.__session;
  window.__gaps = []; let last = performance.now();
  const f = () => { const n = performance.now(); if (n - last > 150) window.__gaps.push(Math.round(n - last)); last = n; requestAnimationFrame(f); }; requestAnimationFrame(f);
  for (const k of ['KeyW', 'Space', 'Mouse0']) s.input.down.add(k);
  setInterval(() => { s.input.yaw += 7; }, 50);
});
for (let t = 0; t < secs; t += 5) {
  await p.waitForTimeout(5000);
  const st = await p.evaluate(() => {
    const s = window.__session, c = s.camera.position;
    return { gaps: window.__gaps.splice(0), fps: s.fps, cpu: +(s.cpuMs || 0).toFixed(1), gt: +s.game.time.toFixed(1), cam: [c.x, c.y, c.z].map(Math.round), vh: s.viewHeight, so: s.stepOffset, org: s.me.ps.origin.map(Math.round), calls: s.renderer.info.render.calls };
  });
  console.log(t + 5, JSON.stringify(st));
  for (const [k, n] of errs) console.log(`  ERR x${n}: ${k}`);
  errs.clear();
}
await b.close();
