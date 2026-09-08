import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

await import('./bz-hub-landscape/scene-model.js');
const model = globalThis.BZSceneModel;
const localDate = (hour, minute = 0, second = 0) => new Date(2026, 8, 7, hour, minute, second);
for (let minute = 0; minute < 1440; minute++) {
  const weights = model.timeWeights(localDate(0, minute));
  assert.ok(Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Object.values(weights).every(value => value >= 0 && value <= 1));
}
for (const [hour, name] of [[0,'night'],[5,'dawn'],[8,'day'],[17,'dusk'],[20,'night']])
  assert.equal(model.scene(localDate(hour), null).name, name);
assert.deepEqual(Object.values(model.scene(localDate(12), { weatherCode: 305 }).weights).filter(Boolean), [1]);
assert.equal(model.timeWeights(localDate(12)).day, 1);
assert.equal(model.timeWeights(localDate(23)).night, 1);
const rainLevels = [305, 306, 307, 310].map(weatherCode => model.weatherProfile({ weatherCode }).intensity);
assert.ok(rainLevels.every((level, i) => !i || level > rainLevels[i - 1]));
assert.equal(model.weatherProfile({ weatherCode: 313, label: '冻雨' }).kind, 'rain');
assert.equal(model.weatherProfile({ weatherCode: 104, label: '阴' }).kind, 'none');
assert.equal(model.weatherProfile({ weatherCode: 501 }).kind, 'fog');
assert.equal(model.weatherProfile({ weatherCode: 403 }).intensity, 1);
assert.equal(model.effectiveDate(localDate(12), { enabled: true, time: '23:30' }).getHours(), 23);
assert.equal(model.effectiveDate(localDate(12), { enabled: false, time: '23:30' }).getHours(), 12);
assert.equal(model.effectiveDate(localDate(12), { enabled: true, time: '99:99' }).getHours(), 12);
assert.equal(model.resolveDate(localDate(12), { enabled: true, time: '23:30' }, 'auto').getHours(), 23);
assert.equal(model.resolveDate(localDate(12), { enabled: true, time: '23:30' }, 'dawn').getHours(), 6);
assert.equal(model.resolveDate(localDate(12), null, 'night').getHours(), 23);
assert.equal(model.scene(localDate(12), model.resolveWeather(null, 'fog')).name, 'fog');
assert.equal(model.weatherProfile(model.resolveWeather(null, 'rain_heavy')).intensity, 1);
assert.equal(model.weatherProfile(model.resolveWeather(null, 'thunderstorm')).thunder, true);
assert.equal(model.scene(localDate(12), model.resolveWeather(null, 'snow_medium')).name, 'snow');
assert.equal(model.resolveWeather({ weatherCode: 305 }, 'auto').weatherCode, 305);
const rect = model.cover(3440, 1440, 1672, 941);
assert.ok(Math.abs(rect.width / rect.height - 1672 / 941) < 1e-9);

// Execute the production outgoing snapshot builder without a test-only copy of its logic.
const source = await readFile(new URL('../src/lib/wallpaper.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(js, sandbox);
const { createWallpaperSnapshot, wallpaperWeatherOptions } = sandbox.exports;
const preferences = { wallpaperEnabled: true, wallpaperSimulationEnabled: true, wallpaperSimulationTime: '23:30',
  wallpaperSimulationWeather: 'storm', wallpaperSimulationWindSpeed: 65, qweatherApiKey: 'DO-NOT-PUBLISH', aiControlToken: 'DO-NOT-PUBLISH' };
const real = Object.freeze({ city: '上海', temperature: 30, apparentTemperature: 32, weatherCode: 100,
  label: '晴', icon: '☀', fetchedAt: '2026-09-07T00:00:00Z' });
const snapshot = createWallpaperSnapshot(preferences, real, 'real weather failed', localDate(12));
assert.equal(snapshot.weather.weatherCode, 310);
assert.equal(snapshot.simulation.time, '23:30');
assert.equal(snapshot.error, undefined);
assert.equal(real.weatherCode, 100);
assert.ok(!JSON.stringify(snapshot).includes('DO-NOT-PUBLISH'));
for (const preset of wallpaperWeatherOptions) {
  assert.equal(createWallpaperSnapshot({ ...preferences, wallpaperSimulationWeather: preset.value }, null).available, true);
}
const restored = createWallpaperSnapshot({ ...preferences, wallpaperSimulationEnabled: false }, real);
assert.equal(restored.weather, real);
assert.equal(restored.simulation.enabled, false);
const disabled = createWallpaperSnapshot({ ...preferences, wallpaperEnabled: false }, real);
assert.equal(disabled.available, false);
assert.equal(disabled.weather, null);
assert.equal(disabled.simulation.enabled, false);
assert.equal(createWallpaperSnapshot({ ...preferences, wallpaperSimulationWindSpeed: NaN }, null).weather.windSpeed, '12');
for (const name of model.names) {
  const png = await readFile(new URL(`./bz-hub-landscape/assets/${name}.png`, import.meta.url));
  assert.equal(png.readUInt32BE(16), 3440, `${name} width`);
  assert.equal(png.readUInt32BE(20), 1440, `${name} height`);
  assert.ok(png.length > 1_000_000, `${name} suspiciously empty`);
}
console.log('PASS: single-image selection, standalone time/weather controls, weather intensity, isolated simulation, restoration, secret exclusion and 7 exact-resolution assets.');
