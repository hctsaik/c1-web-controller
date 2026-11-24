import { createServer } from 'node:http';
import { readFile, mkdir, rm } from 'node:fs/promises';
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
  await page.waitForTimeout(250);
}

async function stubApis(page) {
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
}

async function seedShortChart(page) {
  await page.addInitScript(() => {
    localStorage.setItem('c1-practice-board.charts.v1', JSON.stringify([
      {
        id: 'user-shot',
        title: '練習曲',
        text: '標題: 練習曲\n調: C\n速度: 240\n每格拍數: 1\n[C] 一 [G] 二 [Am] 三 [F] 四',
        sourceNote: '我的自製曲譜',
      },
    ]));
  });
}

const server = await startServer();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--headless=new', '--no-sandbox'],
});
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
  await shot(page, '01-songs-unsupported.png');
  await page.close();
}

// 2) Songs list with Bluetooth stub
{
  const page = await context.newPage();
  await stubApis(page);
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await waitFonts(page);
  await shot(page, '02-songs.png');
  await page.close();
}

// 3–8) Mock connected states
{
  const page = await context.newPage();
  await seedShortChart(page);
  await page.goto(`${base}/?mock=1`, { waitUntil: 'networkidle' });
  await waitFonts(page);
  await page.evaluate(() => {
    const el = document.getElementById('mock-banner');
    if (el) el.hidden = true;
  });
  await shot(page, '03-songs-mock.png');

  await page.getByRole('button', { name: /小星星/ }).click();
  await page.waitForSelector('#view-play:not([hidden])');
  await waitFonts(page);
  await shot(page, '04-play.png');

  await page.getByRole('button', { name: '開始彈唱' }).click();
  await page.waitForTimeout(700);
  const cPad = page.locator('#neck-leds .led[data-label="C"]');
  if (await cPad.count()) await cPad.click({ force: true });
  await page.waitForTimeout(200);
  await shot(page, '05-play-running.png');

  await page.getByRole('button', { name: '從頭再來' }).click();
  await page.getByRole('button', { name: '返回曲譜' }).click();
  await page.waitForSelector('#view-songs:not([hidden])');

  await page.getByRole('button', { name: '和弦指板' }).click();
  await page.waitForSelector('#view-pads:not([hidden])');
  await page.getByRole('button', { name: 'C 調、和弦 1、撥片中立、120 BPM' }).click({ force: true }).catch(async () => {
    // Fixture buttons live in 設定 → 除錯; jump there, fire, come back.
    await page.getByRole('button', { name: '設定' }).click();
    await page.locator('#debug').evaluate((el) => { el.open = true; });
    await page.getByRole('button', { name: 'C 調、和弦 1、撥片中立、120 BPM' }).click({ force: true });
    await page.getByRole('button', { name: '和弦指板' }).click();
  });
  await waitFonts(page);
  await shot(page, '06-pads.png');

  await page.getByRole('button', { name: '設定' }).click();
  await page.waitForSelector('#view-settings:not([hidden])');
  await page.locator('#debug').evaluate((el) => { el.open = false; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitFonts(page);
  await shot(page, '07-settings.png');

  await page.locator('#debug').evaluate((el) => { el.open = true; el.scrollIntoView({ block: 'start' }); });
  await page.waitForTimeout(200);
  await shot(page, '08-debug.png');

  await page.getByRole('button', { name: '曲譜' }).click();
  await page.getByRole('button', { name: '＋ 自製曲譜' }).click();
  await page.waitForSelector('#view-editor:not([hidden])');
  await waitFonts(page);
  await shot(page, '09-editor.png');

  await page.getByRole('button', { name: '返回' }).click();
  await page.getByRole('button', { name: /練習曲/ }).click();
  await page.waitForSelector('#view-play:not([hidden])');
  await page.getByRole('button', { name: '開始彈唱' }).click();
  for (const label of ['C', 'G', 'Am', 'F']) {
    const pad = page.locator(`#neck-leds .led[data-label="${label}"]`);
    if (await pad.count()) await pad.click({ force: true });
    await page.waitForTimeout(230);
  }
  await page.waitForSelector('#view-recap:not([hidden])', { timeout: 4000 });
  await waitFonts(page);
  await shot(page, '10-recap.png');
  await page.close();
}

await browser.close();
server.close();
