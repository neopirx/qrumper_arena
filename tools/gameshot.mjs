// Screenshot fixed viewpoints of a running match: node tools/gameshot.mjs <map> <outPrefix> [bots]
// (needs `npx vite --port 5199`). Viewpoints are [x, y, z, yaw, pitch] per map below.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
const pwDir = homedir() + '/.cache/ms-playwright';
const chromeDir = existsSync(pwDir) && readdirSync(pwDir).find((d) => /^chromium-\d+$/.test(d));
const VIEWS = {
  bastion: [[0, 0, 290, 0, 8], [0, 192, -350, 180, -14], [-470, 0, 0, 90, -6], [620, 256, -660, 90, -4], [520, -96, 820, 45, 6], [700, 64, 150, -35, 8]],
  skywalk: [[0, 0, 140, 0, 8], [-120, 320, -760, -120, -10], [600, 160, -200, 120, -5], [0, -128, 600, 180, 10], [-860, 0, 400, 180, 20], [860, 160, 0, 90, 25]],
  spire: [[420, 0, 460, 40, 12], [-176, 192, 176, -45, -8], [0, 192, -740, 0, -8], [-900, 192, -420, 135, -14], [720, 96, 0, -90, -4], [0, -96, 900, 180, 2]],
};
const [map = 'bastion', out = 'shot', bots = '3'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: chromeDir ? `${pwDir}/${chromeDir}/chrome-linux/chrome` : undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('pageerror', e.stack || e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 300)); });
await p.goto(`http://localhost:5199/?autostart=${map}&bots=${bots}&skill=1`);
await p.waitForFunction(() => window.__session && window.__session.running, null, { timeout: 600000 });
const views = process.env.VIEWS ? JSON.parse(process.env.VIEWS) : VIEWS[map];
for (let i = 0; i < views.length; i++) {
  await p.evaluate((v) => {
    const s = window.__session;
    s.me.ps.origin = [v[0], v[1] + 24.125, v[2]]; s.me.ps.velocity = [0, 0, 0]; s.me.prev = [...s.me.ps.origin];
    s.input.yaw = v[3]; s.input.pitch = v[4];
    s.me.health = 999; for (const b of s.game.players) if (b !== s.me) b.bot && (b.bot.skill = 0);
  }, views[i]);
  await p.evaluate(() => { window.__session.me.health = 999; });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}_${i}.png` });
}
await b.close();
