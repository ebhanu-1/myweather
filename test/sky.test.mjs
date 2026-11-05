import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const K = require('../src/sky.js');
const C = require('../src/core.js');

const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const clearCtx = (elev) => ({ elev, az: 180, moon: { elevDeg: -30, azDeg: 0, illum: 0.5, waxing: true } });

test('palette: brighter with the sun, darkest at night, warm at the horizon in twilight', () => {
  const night = K.skyPalette(-25), dusk = K.skyPalette(-1), noon = K.skyPalette(45);
  assert.ok(lum(night.h) < lum(dusk.h) && lum(dusk.h) < lum(noon.h));
  assert.ok(dusk.h[0] > dusk.h[2], 'horizon at sunset is warm (red above blue)');
  assert.ok(noon.z[2] > noon.z[0], 'noon zenith is blue');
});

test('palette: overcast and rain desaturate and darken, fog whitens the horizon', () => {
  const clear = K.skyPalette(45), grey = K.skyPalette(45, { overcast: 1 }), rainy = K.skyPalette(45, { overcast: 1, rain: 1 }), fog = K.skyPalette(45, { fog: 1 });
  const sat = (c) => Math.max(...c) - Math.min(...c);
  assert.ok(sat(grey.z) < sat(clear.z) * 0.5);
  assert.ok(lum(rainy.z) < lum(grey.z));
  assert.ok(sat(fog.h) < sat(clear.h));
});

test('state: heavy rain, snow, thunder and fog map to the right scene knobs', () => {
  const base = { cloud: 90, tempF: 50, feelsF: 48, windMph: 10, windDir: 200, visMi: 10, snowIn: 0, precipIn: 0 };
  const rain = K.stateFrom(Object.assign({}, base, { precipIn: 0.3, code: 65 }), clearCtx(20), C.codeInfo(65));
  assert.ok(rain.rain > 0.9 && rain.snow === 0 && rain.low >= 0.75);
  const snow = K.stateFrom(Object.assign({}, base, { tempF: 28, snowIn: 0.4, precipIn: 0.05, code: 73 }), clearCtx(20), C.codeInfo(73));
  assert.ok(snow.snow > 0.4 && snow.rain === 0);
  assert.equal(K.stateFrom(Object.assign({}, base, { code: 95, precipIn: 0.2 }), clearCtx(20), C.codeInfo(95)).thunder, 1);
  assert.ok(K.stateFrom(Object.assign({}, base, { code: 45, visMi: 0.2 }), clearCtx(20), C.codeInfo(45)).fog >= 0.9);
  const clear = K.stateFrom(Object.assign({}, base, { cloud: 5, cloudLow: 0, cloudMid: 0, cloudHigh: 5, code: 0 }), clearCtx(30), C.codeInfo(0));
  assert.ok(clear.rain === 0 && K.overcastOf(clear) < 0.05);
});

test('state: missing layer values fall back to the total cover, smoke raises haze', () => {
  const s = K.stateFrom({ cloud: 80, tempF: 60, feelsF: 60, aqi: 180 }, clearCtx(30), C.codeInfo(2));
  assert.ok(s.low > 0.3 && s.haze > 0.9 && s.wind === 0);
});
