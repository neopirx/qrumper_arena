// Screenshot the menu panels: node tools/menushot.mjs <outPrefix>   (needs `npx vite --port 5199`)
// Captures main menu, profile (with the 3D model preview) and the weapon-placement settings tab.
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
const pwDir = homedir() + '/.cache/ms-playwright';
const chromeDir = existsSync(pwDir) && readdirSync(pwDir).find((d) => /^chromium-\d+$/.test(d));
const out = process.argv[2] || 'menu';
const b = await chromium.launch({ executablePath: chromeDir ? `${pwDir}/${chromeDir}/chrome-linux/chrome` : undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
p.on('pageerror', (e) => console.log('pageerror', e.stack || e.message));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 300)); });
await p.goto('http://localhost:5199/');
// skip the first-run fighter setup
await p.evaluate(() => localStorage.setItem('qrumper.profile.v1', JSON.stringify({ name: 'Player', character: 'capi', color: 0x3d8bff })));
await p.goto('http://localhost:5199/');
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}_main.png` });
await p.click('#mainnav [data-go="p-profile"]');
await p.waitForFunction(() => document.querySelector('#profile-stage canvas'), null, { timeout: 180000 });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}_profile.png` });
await p.click('#chars .char:nth-child(2)');
await p.click('#swatches button:nth-child(3)');
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}_profile2.png` });
await p.click('#p-profile [data-go="p-main"]');
await p.click('#mainnav [data-go="p-settings"]');
await p.click('[data-tab="t-weapon"]');
await p.waitForFunction(() => document.querySelector('#gun-preview canvas'), null, { timeout: 60000 });
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}_weapon.png` });
for (const [i, id] of ['sg', 'gl', 'rl', 'rg'].entries()) {
  await p.click(`#gun-pick [data-w="${id}"]`);
  await p.waitForTimeout(400);
  await p.locator('#gun-preview').screenshot({ path: `${out}_gun_${id}.png` });
}
await p.click('#gunHand [data-v="center"]');
await p.waitForTimeout(400);
await p.locator('#gun-preview').screenshot({ path: `${out}_gun_center.png` });
await p.click('#gunHand [data-v="right"]');
await b.close();
