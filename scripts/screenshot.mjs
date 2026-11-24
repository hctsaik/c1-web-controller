import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'screenshots');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let path = decodeURIComponent((req.url || '/').split('?')[0]);
        if (path === '/') path = '/index.html';
        const file = join(root, path);
        if (!file.startsWith(root)) {
          res.writeHead(403).end('forbidden');
          return;
        }
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404).end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function shot(page, name) {
  const file = join(outDir, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log('wrote', file);
}

async function waitFonts(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

const server = await startServer();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--headless=new', '--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2.5,
  locale: 'zh-TW',
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
});

// 1) Feature-detect (no Web Bluetooth)
{
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await waitFonts(page);
  await shot(page, '01-unsupported.png');
  await page.close();
}

// 2) Landing as Chrome-like (stub bluetooth + midi)
{
  const page = await context.newPage();
  await page.addInitScript(() => {
    navigator.bluetooth = {
      requestDevice: () => Promise.reject(new DOMException('cancelled', 'NotFoundError')),
      getDevices: () => Promise.resolve([]),
    };
    navigator.requestMIDIAccess = () =>
      Promise.resolve({
        inputs: { values: () => [].values() },
        outputs: { values: () => [].values() },
        onstatechange: null,
      });
  });
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await waitFonts(page);
  await shot(page, '02-landing.png');
  await page.close();
}

// 3–6) Mock connected states
{
  const page = await context.newPage();
  await page.goto(`${base}/?mock=1`, { waitUntil: 'networkidle' });
  await waitFonts(page);
  await page.getByRole('button', { name: 'C 調、和弦 1、撥片中立、120 BPM' }).click({ force: true });
  await page.evaluate(() => document.getElementById('live').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(250);
  await shot(page, '03-mock-live.png');

  await page.evaluate(() => document.getElementById('controls').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(200);
  await shot(page, '04-controls.png');

  await page.evaluate(() => document.getElementById('debug').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(200);
  await shot(page, '05-debug.png');

  await page.goto(`${base}/?mock=1&theme=light`, { waitUntil: 'networkidle' });
  await waitFonts(page);
  await page.getByRole('button', { name: 'G 調、和弦 5、撥片 A 向下' }).click({ force: true });
  await page.evaluate(() => document.getElementById('live').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(250);
  await shot(page, '06-light.png');

  await page.goto(`${base}/?mock=1`, { waitUntil: 'networkidle' });
  await waitFonts(page);
  await page.getByRole('button', { name: 'C 調、和弦 1、撥片中立、120 BPM' }).click({ force: true });
  await page.getByRole('button', { name: '寫入和弦對應' }).click();
  await page.waitForTimeout(200);
  const full = join(outDir, '07-full-page.png');
  await page.screenshot({ path: full, fullPage: true });
  console.log('wrote', full);
  await page.close();
}

await browser.close();
server.close();
