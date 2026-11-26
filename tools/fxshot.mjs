// Screenshot the weapon effects in a running match: node tools/fxshot.mjs <out.png> [delayMs]
// (needs `npx vite --port 5199`)
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
const pwDir = homedir() + '/.cache/ms-playwright';
const chromeDir = existsSync(pwDir) && readdirSync(pwDir).find((d) => /^chromium-\d+$/.test(d));
const b = await chromium.launch({ executablePath: chromeDir ? `${pwDir}/${chromeDir}/chrome-linux/chrome` : undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('pageerror', e.stack || e.message));
await p.goto('http://localhost:5199/?autostart=bastion&bots=1&skill=1');
await p.waitForFunction(() => window.__session && window.__session.running, null, { timeout: 600000 });
await p.evaluate(() => {
  const s = window.__session;
  for (const pl of s.game.players) if (pl !== s.me) pl.ps.origin = [800, 200, 800];
  s.me.health = 999; s.me.ps.origin = [-640, 24.125, 250]; s.me.prev = [...s.me.ps.origin]; s.input.yaw = 0; s.input.pitch = 0;
});
await p.waitForTimeout(600);
// stop the loop, fire everything, then step the renderer by hand to fixed effect ages
await p.evaluate(() => {
  const s = window.__session, fx = s.effects;
  s.running = false; cancelAnimationFrame(s.raf);
  s.hud.center('', 0);
  fx.explosion([-560, 0, -40], [0, 1, 0], true, s.camera.position);
  fx.rail([-700, 40, 200], [-760, 90, -280], 0x30e8ff, [0, 0, 1], true);
  fx.explosion([-500, 60, -200], [0, 0, 1], false);
  for (let i = 0; i < 4; i++) fx.bulletImpact([-610 + i * 12, 30 + i * 10, -288], [0, 0, 1], 'mg', [-640, 50, 220]);
  fx.muzzleFlash([-600, 50, 100], 0xff9a26, 200, [0, 0, -1], 'sg');
});
let age = 0;
for (const target of [0.05, 0.15, 0.6]) {
  await p.evaluate((dt) => { const s = window.__session; for (let t = 0; t < dt - 1e-6; t += 0.025) { s.effects.shake = 0; s.render(0.025, 0); } }, target - age);
  age = target;
  await p.screenshot({ path: process.argv[2].replace('.png', `_${Math.round(target * 100)}.png`) });
}
await b.close();
