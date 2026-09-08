// Browser integration checks. Pass a Playwright module path or install playwright locally.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const { chromium } = await import(process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'wallpaper-engine/qa');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const target = path.resolve(root, '.' + pathname);
  if (!target.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(target);
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.css': 'text/css', '.json': 'application/json' })[path.extname(target)] || 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 3440, height: 1440 }, deviceScaleFactor: 1 });
context.setDefaultTimeout(15000);
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.text().includes('Landscape GPU fallback')) errors.push(message.text()); });
let snapshot = { available: true, weather: { weatherCode: 100, windSpeed: '0' }, simulation: { enabled: true, time: '12:00' } };
let requests = 0, offline = false;
await page.route('http://127.0.0.1:43821/**', route => {
  requests++;
  return offline ? route.abort() : route.fulfill({ json: snapshot });
});
try {
  if (!process.argv.includes('--ui-only')) {
  await page.goto(`http://127.0.0.1:${server.address().port}/wallpaper-engine/bz-hub-landscape/index.html`);
  await page.waitForFunction(() => document.querySelector('.scene__water').style.opacity === '1');
  await page.waitForTimeout(4000);
  const first = await page.screenshot({ path: path.join(output, 'day.png') });
  await page.waitForTimeout(700);
  const second = await page.screenshot();
  assert.ok(!first.equals(second), 'water should move in clear calm weather');
  assert.deepEqual(await page.locator('.scene__water').evaluate(el => [el.width, el.height]), [3440, 1440]);
  assert.equal(await page.evaluate(() => document.querySelector('.scene__water').getContext('webgl').getError()), 0);
  for (const [name, code, wind] of [['light-rain',305,12], ['storm',310,65], ['snow',403,55], ['floaters',100,0], ['fog',501,12]]) {
    snapshot = { ...snapshot, weather: { weatherCode: code, windSpeed: String(wind) } };
    await page.waitForFunction(expected => {
      const p = window.BZSceneModel.weatherProfile(expected);
      return document.documentElement.dataset.weather === p.kind && document.documentElement.dataset.intensity === String(p.intensity);
    }, snapshot.weather);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(output, `${name}.png`) });
  }
  snapshot = { ...snapshot, weather: { weatherCode: 310, windSpeed: '30' }, simulation: { enabled: true, time: '23:00' } };
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(output, 'night-rain.png') });
  offline = true;
  await page.evaluate(() => { window.realDateNow = Date.now; Date.now = () => window.realDateNow() + 31000; });
  await page.waitForFunction(() => document.documentElement.dataset.simulated === 'false');
  await page.evaluate(() => { Date.now = window.realDateNow; });
  offline = false;
  await page.waitForFunction(() => document.documentElement.dataset.simulated === 'true');
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.wallpaperPropertyListener.setPaused(true));
  await page.waitForTimeout(300);
  const paused = await page.screenshot();
  await page.waitForTimeout(800);
  assert.ok((await page.screenshot()).equals(paused), 'paused scene should stop');
  await page.evaluate(() => window.wallpaperPropertyListener.setPaused(false));
  snapshot = { enabled: false, available: false, weather: null, simulation: { enabled: false, time: null } };
  await page.waitForFunction(() => document.documentElement.dataset.simulated === 'false' && document.documentElement.dataset.weather === 'none');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(500);
  assert.deepEqual(await page.locator('.scene__water').evaluate(el => [el.width, el.height]), [1920,1080]);
  await page.waitForTimeout(5000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(1000);
  const still = await page.screenshot();
  await page.waitForTimeout(700);
  assert.ok((await page.screenshot()).equals(still), 'reduced motion should stop effects');
  assert.deepEqual(errors, []);
  assert.ok(requests > 5);
  console.log('PASS: real WebGL rendering, moving water, 5 weather states, night rain, pause/resume, bridge off and resize.');
  }
  // Check the actual Settings UI without touching the user's persisted desktop data.
  const hub = await context.newPage();
  await hub.setViewportSize({ width: 720, height: 760 });
  await hub.route('**/assets/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith('/assets/')) return route.continue();
    const body = await readFile(path.join(root, 'dist', pathname));
    return route.fulfill({ body, contentType: pathname.endsWith('.css') ? 'text/css' : 'text/javascript' });
  });
  await hub.goto(`http://127.0.0.1:${server.address().port}/dist/index.html`);
  await hub.getByRole('button', { name: '设置', exact: true }).click();
  const toggle = hub.getByRole('switch', { name: '模拟桌面天气与时间' });
  await toggle.scrollIntoViewIfNeeded(); await toggle.click();
  await hub.getByLabel('模拟时间（固定在此时刻）').fill('23:30');
  await hub.getByLabel('模拟天气', { exact: true }).selectOption('storm');
  await hub.waitForTimeout(700);
  await hub.screenshot({ path: path.join(output, 'hub-simulation.png') });
  const stored = await hub.evaluate(() => JSON.parse(localStorage.getItem('bz-hub-state-v1')));
  assert.equal(stored.devicePreferences.wallpaperSimulationWeather, 'storm');
  assert.equal(stored.devicePreferences.wallpaperSimulationTime, '23:30');
  assert.equal(stored.sharedPreferences.weatherCity, '上海');
  console.log('PASS: Settings simulation controls save locally without changing real weather city.');
} finally {
  await browser.close(); server.close();
}
