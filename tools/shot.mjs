// Screenshot a dev page: node tools/shot.mjs <path> <out.png>   (needs `npx vite --port 5199`)
import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
const pwDir = homedir() + '/.cache/ms-playwright';
const chromeDir = existsSync(pwDir) && readdirSync(pwDir).find((d) => /^chromium-\d+$/.test(d));
const b = await chromium.launch({ executablePath: chromeDir ? `${pwDir}/${chromeDir}/chrome-linux/chrome` : undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto('http://localhost:5199' + process.argv[2]);
await p.waitForFunction(() => document.title === 'ready', null, { timeout: 120000 });
await p.screenshot({ path: process.argv[3] });
await b.close();
