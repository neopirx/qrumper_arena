// Map card thumbnail: node tools/thumb.mjs <map> '[x,y,z,yaw,pitch]' <out.png>  (needs npx vite --port 5199)
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
const pwDir = homedir() + '/.cache/ms-playwright';
const chromeDir = existsSync(pwDir) && readdirSync(pwDir).find((d) => /^chromium-\d+$/.test(d));
const b = await chromium.launch({ executablePath: chromeDir ? `${pwDir}/${chromeDir}/chrome-linux/chrome` : undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const [map, v, out] = [process.argv[2], JSON.parse(process.argv[3]), process.argv[4]];
const p = await b.newPage({ viewport: { width: 1280, height: 480 } });
await p.goto(`http://localhost:5199/?autostart=${map}&bots=1&skill=1`);
await p.waitForFunction(() => window.__session && window.__session.running, null, { timeout: 600000 });
await p.evaluate((v) => { const s = window.__session; s.settings.gunVisible = false; document.getElementById('hud').style.display = 'none';
  s.me.ps.origin = [v[0], v[1] + 24.125, v[2]]; s.me.prev = [...s.me.ps.origin]; s.input.yaw = v[3]; s.input.pitch = v[4];
  for (const b of s.game.players) if (b !== s.me) { b.bot.think = () => {}; b.ps.origin = [0, -5000, 0]; } s.me.health = 999; }, v);
await p.waitForTimeout(2500);
await p.screenshot({ path: out });
await b.close();
