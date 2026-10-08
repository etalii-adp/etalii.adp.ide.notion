// Takes the screenshots of docs/screenshots/, as readme.md beside this file describes them.
//
//   node docs/screenshots/capture.mjs [<image> ...]
//
// It builds the add-ons, runs the local service with an in-memory Notion, puts an example into
// its one database, serves the built tree on http://localhost:8080 and drives an installed Chrome
// or Edge over the Chrome DevTools protocol. It needs `npm i --no-save puppeteer-core` first, and
// no account anywhere. It exits non-zero naming any image whose diagram drew nothing.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = resolve(import.meta.dirname, '..', '..');
const folder = import.meta.dirname;
const STORE = '11111111-1111-4111-8111-111111111111';
const SERVICE = 'http://localhost:8787';
const PAGES = 'http://localhost:8080';

// One entry per image: the add-on, the example put into the store, and the appearance.
const images = {
  'gartner-hype-cycle-graph.png': { addon: 'gartner-hype-cycle-graph', example: 'digital-trends', theme: 'dark' },
  'gartner-hype-cycle-graph-light.png': { addon: 'gartner-hype-cycle-graph', example: 'digital-trends', theme: 'light' },
};

const browsers = [
  process.env.BROWSER,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((path) => path && existsSync(path));
if (browsers.length === 0) {
  console.error('No Chrome or Edge was found. Name one in the environment variable BROWSER.');
  process.exit(2);
}

const wanted = process.argv.slice(2);
const unknown = wanted.filter((name) => !(name in images));
if (unknown.length > 0) {
  console.error(`No such image: ${unknown.join(', ')}. The images are ${Object.keys(images).join(', ')}.`);
  process.exit(2);
}
const names = wanted.length > 0 ? wanted : Object.keys(images);

const run = (args, env = {}) => {
  const result = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

const out = mkdtempSync(join(tmpdir(), 'adp-notion-'));
run(['scripts/build.mjs', '--out', out]);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const pages = createServer((request, response) => {
  let path = join(out, decodeURIComponent(new URL(request.url, PAGES).pathname));
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) return response.writeHead(404).end();
  response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
}).listen(8080);

const failures = [];
let stored;
let service;
const browser = await puppeteer.launch({ executablePath: browsers[0], headless: true, args: ['--force-device-scale-factor=1'] });
try {
  for (const name of names) {
    const { addon, example, theme } = images[name];
    if (stored !== `${addon}/${example}`) {
      // A fresh in-memory Notion per document, so that a store never holds two.
      service?.kill();
      service = spawn(process.execPath, ['scripts/service.mjs', '--memory'], { cwd: root, env: { ...process.env, ALLOWED_ORIGIN: PAGES }, stdio: 'ignore' });
      await new Promise((ready) => setTimeout(ready, 1500));
      run(['scripts/store.mjs', 'put', STORE, `test/examples/${addon}/${example}/${example}.ghg`, '--addon', addon, '--service', SERVICE], { NOTION_TOKEN: 'memory-token' });
      stored = `${addon}/${example}`;
    }
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
    // The grant of access is not what an image shows: the page starts with the token it would end with.
    await page.evaluateOnNewDocument(() => localStorage.setItem('adp-notion.token', JSON.stringify({ token: 'memory-token', refresh: '', workspace: 'Memory' })));
    await page.goto(`${PAGES}/${addon}/?store=${STORE}&theme=${theme}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('body[data-state="ready"]', { timeout: 30000 });
    await page.waitForSelector('#canvas [data-element]', { timeout: 30000 });

    // A readable size with the middle of the drawing in view, as the other hosts' images have it.
    const canvas = await page.$('#canvas');
    const box = await canvas.boundingBox();
    const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(middle.x, middle.y);
    await page.keyboard.down('Control');
    for (let step = 0; step < 3; step++) await page.mouse.wheel({ deltaY: -100 });
    await page.keyboard.up('Control');

    // One element selected, the one drawn nearest the middle, so the property grid shows its properties.
    const nearest = await page.evaluate(({ x, y }) => {
      let best;
      for (const element of document.querySelectorAll('#canvas .adp-canvas-nodes [data-element]')) {
        const at = element.getBoundingClientRect();
        if (at.width === 0) continue;
        const distance = Math.hypot(at.x + at.width / 2 - x, at.y + at.height / 2 - y);
        if (!best || distance < best.distance) best = { distance, x: at.x + at.width / 2, y: at.y + at.height / 2 };
      }
      return best;
    }, middle);
    if (nearest) await page.mouse.click(nearest.x, nearest.y);
    await new Promise((settled) => setTimeout(settled, 500));

    const shown = await page.evaluate(() => ({
      elements: document.querySelectorAll('#canvas [data-element]').length,
      tools: document.querySelectorAll('#toolbox [data-tool]').length,
      properties: document.querySelectorAll('#property-grid [data-attribute]').length,
    }));
    if (shown.elements === 0) failures.push(`${name}: the diagram drew nothing`);
    if (shown.tools === 0) failures.push(`${name}: the toolbox is empty`);
    if (shown.properties === 0) failures.push(`${name}: the property grid is empty`);
    await page.screenshot({ path: join(folder, name), type: 'png' });
    console.log(`${name}: ${shown.elements} elements, ${shown.tools} tools, ${shown.properties} properties`);
    await page.close();
  }
} finally {
  await browser.close();
  service?.kill();
  pages.close();
}

for (const failure of failures) console.error(failure);
process.exit(failures.length > 0 ? 1 : 0);
