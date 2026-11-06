import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../src/core.js');
const P = require('../src/providers.js');

const ANDOVER = { lat: 42.66, lon: -71.15, tz: 'America/New_York' };
const T0 = Date.parse('2026-11-05T05:00:00Z'); // local midnight, Nov 5 2026 (EST)

// Hand-built hourly series: fields not named by the scenario stay at calm, clear, dry defaults.
function series(n, fn, start) {
  const t0 = start == null ? T0 : start;
  return Array.from({ length: n }, (_, i) => Object.assign({
    ms: t0 + i * 3600000, tempF: 65, feelsF: 65, rh: 45, dewF: 42, pop: 0, precipIn: 0, snowIn: 0, code: 0, cloud: 10, cloudLow: 5, cloudMid: 5, cloudHigh: 5,
    visMi: 10, windMph: 5, gustMph: 8, windDir: 270, uv: 3, rad: 400, pressHpa: 1015, aqi: 30, pm25: 5,
  }, fn(i)));
}

test('sun position: noon sun over Andover in early November is about 31 degrees up (90 - lat + declination), due south', () => {
  const noon = Date.parse('2026-11-05T16:29:00Z');
  const s = C.sunPosition(ANDOVER.lat, ANDOVER.lon, noon);
  assert.ok(s.elevDeg > 30 && s.elevDeg < 33, 'elev ' + s.elevDeg);
  assert.ok(Math.abs(s.azDeg - 180) < 6, 'az ' + s.azDeg);
  assert.ok(C.sunPosition(ANDOVER.lat, ANDOVER.lon, noon - 12 * 3600000).elevDeg < -20);
});

test('sunrise and sunset for Andover on 2026-11-05 land near 6:20 and 4:30 local', () => {
  const t = C.sunTimes(ANDOVER.lat, ANDOVER.lon, '2026-11-05', ANDOVER.tz);
  assert.match(C.hourLabel(t.sunrise, ANDOVER.tz), /^6:\d\d AM$/);
  assert.match(C.hourLabel(t.sunset, ANDOVER.tz), /^4:\d\d PM$/);
});

test('moon phase: new and full moons from published dates', () => {
  const at = (iso) => C.moonState(ANDOVER.lat, ANDOVER.lon, Date.parse(iso));
  assert.ok(at('2025-10-21T12:25:00Z').illum < 0.03, 'new moon 2025-10-21');
  assert.ok(at('2025-11-05T13:19:00Z').illum > 0.97, 'full moon 2025-11-05');
  assert.ok(at('2025-10-28T00:00:00Z').waxing === true);
  assert.ok(at('2025-11-12T00:00:00Z').waxing === false);
  assert.equal(C.moonName(0.5), 'Full moon');
});

test('moon height: a full moon is up at local midnight, a new moon is not', () => {
  const full = C.moonState(ANDOVER.lat, ANDOVER.lon, Date.parse('2025-11-06T05:30:00Z'));
  assert.ok(full.elevDeg > 20, 'full moon at midnight ' + full.elevDeg);
  const newm = C.moonState(ANDOVER.lat, ANDOVER.lon, Date.parse('2025-10-22T05:30:00Z'));
  assert.ok(newm.elevDeg < 0, 'new moon at midnight ' + newm.elevDeg);
});

test('wind chill and heat index match the NWS tables', () => {
  assert.ok(Math.abs(C.windChillDelta(20, 15) - (6 - 20)) < 1, 'wind chill 20F at 15 mph is about 6F');
  assert.equal(C.windChillDelta(60, 15), 0);
  assert.ok(Math.abs(C.heatIndexDelta(90, 70) - 15) < 2, 'heat index 90F/70% is about 105F');
  assert.equal(C.heatIndexDelta(70, 70), 0);
});

test('feels story: a cold windy day names the wind, a muggy day names the humidity', () => {
  const cold = C.feelsStory({ tempF: 30, feelsF: 18, rh: 50, dewF: 15, windMph: 16, gustMph: 24, precipIn: 0, snowIn: 0, cloud: 20, rad: 300, visMi: 10 });
  assert.equal(cold.word, 'frigid');
  assert.match(cold.headline, /breezy/);
  assert.ok(cold.drivers.some((d) => d.kind === 'wind' && /Wind takes \d+° off/.test(d.text)));
  const muggy = C.feelsStory({ tempF: 88, feelsF: 98, rh: 70, dewF: 72, windMph: 4, gustMph: 8, precipIn: 0, snowIn: 0, cloud: 30, rad: 700, visMi: 8 });
  assert.equal(muggy.word, 'sweltering');
  assert.ok(muggy.tags.includes('muggy'));
  assert.ok(muggy.drivers.some((d) => d.kind === 'humidity'));
});

test('vibe: severity order puts storms before everything and heat before pleasantries', () => {
  const base = { feelsF: 70, tempF: 70, dewF: 50, windMph: 5, cloud: 20, rad: 500, visMi: 10, code: 0 };
  const day = { elev: 40, hour: 13 };
  assert.match(C.vibe(Object.assign({}, base, { code: 95 }), day), /Thunder/);
  assert.match(C.vibe(Object.assign({}, base, { code: 73 }), day), /Snow/);
  assert.match(C.vibe(Object.assign({}, base, { feelsF: 95, dewF: 70 }), day), /wear/);
  assert.match(C.vibe(base, day), /windows open/);
  assert.ok(C.vibe(Object.assign({}, base, { feelsF: 50 }), { elev: -30, hour: 2 }).length > 10);
});

test('dress: layers follow feels-like, extras follow rain, sun, wind and air', () => {
  const r = { feelsF: 40, tempF: 44, pop: 70, precipIn: 0.05, code: 61, uv: 0, gustMph: 10, aqi: 20, rad: 0, cloud: 100 };
  const d = C.dress(r, { elev: -10 });
  assert.equal(d[0].label, 'Coat over a layer');
  assert.ok(d.some((x) => x.id === 'wet'));
  const hot = C.dress({ feelsF: 92, tempF: 90, pop: 0, uv: 9, cloud: 5, gustMph: 6, rad: 900, aqi: 120, code: 0 }, { elev: 60 });
  assert.equal(hot[0].label, 'Shorts, hat, water bottle');
  assert.ok(hot.some((x) => x.id === 'sun') && hot.some((x) => x.id === 'air') && hot.some((x) => x.id === 'pets'));
  assert.ok(!hot.some((x) => x.id === 'wet'));
});

test('activities: a calm dry 70F afternoon is great for a walk, a thunderstorm is not', () => {
  const hours = series(48, () => ({}));
  const noon = T0 + 14 * 3600000; // 2 PM EST... sun still up in November
  const r = C.sampleAt(hours, noon), c = C.contextAt(ANDOVER, hours, noon);
  assert.ok(C.rate('walk', r, c).score >= 80, 'walk ' + C.rate('walk', r, c).score);
  const storm = Object.assign({}, r, { code: 95, pop: 90, precipIn: 0.3 });
  assert.ok(C.rate('walk', storm, c).score <= 20);
  assert.match(C.rate('walk', storm, c).why, /Thunder|Rain/);
});

test('activities: stars need a dark clear night; laundry needs a dry breezy day', () => {
  const hours = series(72, () => ({}));
  const night = Date.parse('2025-10-22T05:00:00Z'); // new moon
  const hs = series(48, () => ({ cloud: 5 }), night - 12 * 3600000);
  assert.ok(C.rate('stars', C.sampleAt(hs, night), C.contextAt(ANDOVER, hs, night)).score >= 75);
  const noon = T0 + 16 * 3600000;
  assert.ok(C.rate('stars', C.sampleAt(hours, noon), C.contextAt(ANDOVER, hours, noon)).score <= 20, 'no stars at noon');
  const cloudyNight = Object.assign({}, C.sampleAt(hs, night), { cloud: 95 });
  assert.ok(C.rate('stars', cloudyNight, C.contextAt(ANDOVER, hs, night)).score < 60);
  const damp = series(48, () => ({ rh: 95, dewF: 63, tempF: 64, pop: 40 }));
  const hot = series(48, () => ({ rad: 700, windMph: 9, dewF: 35, tempF: 70, rh: 30 }));
  const t = T0 + 16 * 3600000;
  assert.ok(C.rate('laundry', C.sampleAt(hot, t), C.contextAt(ANDOVER, hot, t)).score > C.rate('laundry', C.sampleAt(damp, t), C.contextAt(ANDOVER, damp, t)).score + 30);
});

test('best windows: the rainy hours are excluded and the window sits in the dry stretch', () => {
  // 3 days; every day rainy before 1 PM local (hours 5..18 UTC) except day 2 which is dry all day.
  const hours = series(72, (i) => {
    const hr = i % 24, day = Math.floor(i / 24);
    return day === 1 ? {} : hr < 13 ? { pop: 90, precipIn: 0.1, code: 63 } : {};
  });
  const w = C.bestWindows(ANDOVER, hours, 'walk', T0, 3);
  assert.ok(w.length >= 2);
  const first = w.find((x) => x.day === '2026-11-05');
  assert.ok(first && C.localParts(first.startMs, ANDOVER.tz).hour >= 12, 'window starts after the rain');
  assert.ok(w.every((x) => x.peak >= 55 && x.endMs > x.startMs));
});

test('outlook: rain arriving, clearing, a warm-up, and a steady day each get their own sentence', () => {
  const now = T0 + 9 * 3600000;
  const rainy = series(30, (i) => (i >= 12 && i <= 16 ? { precipIn: 0.06, pop: 80, code: 61 } : {}));
  assert.match(C.outlook(rainy, ANDOVER, now), /Rain arrives around 7 AM|Rain arrives around/);
  const wetNow = series(30, (i) => (i >= 6 && i <= 10 ? { precipIn: 0.06, pop: 80, code: 61 } : {}));
  assert.match(C.outlook(wetNow, ANDOVER, T0 + 7 * 3600000), /Rain eases around/);
  const warm = series(30, (i) => ({ feelsF: 50 + Math.min(i, 20), tempF: 50 + Math.min(i, 20) }));
  assert.match(C.outlook(warm, ANDOVER, T0 + 6 * 3600000), /Warming to \d+°/);
  assert.match(C.outlook(series(30, () => ({})), ANDOVER, now), /Steady/);
});

test('versus yesterday words the difference on the feels-like scale', () => {
  const hours = series(60, (i) => ({ feelsF: i < 24 ? 50 : 58 }));
  assert.equal(C.vsYesterday(hours, T0 + 30 * 3600000), '8° warmer than the same time yesterday.');
  assert.equal(C.vsYesterday(series(60, () => ({})), T0 + 30 * 3600000), 'About the same as yesterday.');
  assert.equal(C.vsYesterday(hours, T0 + 3 * 3600000), null);
});

test('nowcast: countdown to rain, how long it lasts, and when it eases', () => {
  const now = Date.parse('2026-11-05T15:05:00Z');
  const slot = (min, p) => ({ ms: Date.parse('2026-11-05T15:00:00Z') + min * 60000, precipIn: p });
  const dry = [0, 15, 30, 45, 60, 75].map((m) => slot(m, 0));
  assert.equal(C.nowcast(dry, now).state, 'dry');
  const soon = [slot(0, 0), slot(15, 0), slot(30, 0.02), slot(45, 0.03), slot(60, 0), slot(75, 0)];
  const n = C.nowcast(soon, now);
  assert.equal(n.state, 'soon');
  assert.match(n.text, /Rain starts in about 25 min, lasting about 30 min/);
  const wet = [slot(0, 0.02), slot(15, 0.02), slot(30, 0), slot(45, 0)];
  assert.match(C.nowcast(wet, now).text, /Rain now, easing in about 25 min/);
  assert.match(C.nowcast([slot(0, 0.02), slot(15, 0.02), slot(30, 0.02)], now, { snow: true }).text, /^Snow now/);
  assert.equal(C.nowcast([], now), null);
  const later = Array.from({ length: 24 }, (_, i) => slot(i * 15, i >= 12 && i < 14 ? 0.02 : 0));
  assert.match(C.nowcast(later, now).text, /Rain starts in about 3 hours, lasting about 30 min/);
});

test('sunset quality: mid and high cloud beats clear sky, low cloud and rain kill it', () => {
  const clear = C.sunsetQuality({ cloudLow: 0, cloudMid: 0, cloudHigh: 0, visMi: 10, pop: 0, precipIn: 0 });
  const canvas = C.sunsetQuality({ cloudLow: 5, cloudMid: 30, cloudHigh: 55, visMi: 10, pop: 5, precipIn: 0 });
  const low = C.sunsetQuality({ cloudLow: 90, cloudMid: 50, cloudHigh: 50, visMi: 10, pop: 10, precipIn: 0 });
  const rain = C.sunsetQuality({ cloudLow: 20, cloudMid: 60, cloudHigh: 60, visMi: 10, pop: 90, precipIn: 0.1 });
  assert.ok(canvas.score > 70 && canvas.label === 'Could be vivid');
  assert.ok(clear.score < canvas.score && clear.score >= 25);
  assert.ok(low.score < 30 && rain.score < 35);
});

test('day grouping cuts local days, finds hi/lo and a representative code', () => {
  const hours = series(72, (i) => ({ tempF: 40 + (i % 24), code: i >= 24 && i < 48 ? 63 : 0, precipIn: i >= 24 && i < 48 ? 0.05 : 0 }));
  const days = C.groupDays(hours, ANDOVER.tz);
  assert.equal(days.length, 3);
  assert.equal(days[0].key, '2026-11-05');
  assert.equal(days[0].hi, 63);
  assert.equal(days[0].lo, 40);
  assert.equal(C.codeInfo(days[1].code).kind, 'rain');
  assert.equal(C.codeInfo(days[0].code).kind, 'clear');
});

test('labels: day names and times are cut in the place time zone', () => {
  const now = Date.parse('2026-11-05T17:00:00Z'); // noon EST Thursday
  assert.equal(C.whenLabel(now + 5 * 60000, now, 'America/New_York'), 'Now');
  assert.equal(C.whenLabel(now + 3 * 3600000, now, 'America/New_York'), 'Today 3 PM');
  assert.equal(C.whenLabel(now + 21 * 3600000, now, 'America/New_York'), 'Tomorrow 9 AM');
  assert.equal(C.dayLabel(now + 3 * 86400000, now, 'America/New_York'), 'Sun');
  assert.equal(C.dirName(225), 'SW');
});

test('sampling blends hours and wraps wind direction through north', () => {
  const hours = series(3, (i) => ({ tempF: 60 + i * 10, windDir: i === 0 ? 350 : 10, code: i === 0 ? 0 : 61 }));
  const mid = C.sampleAt(hours, T0 + 1800000);
  assert.equal(mid.tempF, 65);
  assert.ok(Math.abs(mid.windDir - 0) < 0.001 || Math.abs(mid.windDir - 360) < 0.001, 'wind dir ' + mid.windDir);
  assert.equal(C.sampleAt(hours, T0 - 5 * 3600000).tempF, 60);
});

test('providers: Open-Meteo hourly, minutely and air responses normalize to US-unit records', () => {
  const j = {
    hourly: { time: ['2026-11-05T00:00', '2026-11-05T01:00'], temperature_2m: [50, 52], apparent_temperature: [47, 49], relative_humidity_2m: [60, 62], dew_point_2m: [40, 41], precipitation_probability: [10, null], precipitation: [0, 0.02], snowfall: [0, 0],
      weather_code: [3, 61], cloud_cover: [90, 100], cloud_cover_low: [50, 60], cloud_cover_mid: [30, 30], cloud_cover_high: [10, 0], visibility: [52800, 5280], wind_speed_10m: [8, 9], wind_gusts_10m: [15, 16], wind_direction_10m: [200, 210],
      uv_index: [0, 0], shortwave_radiation: [0, 0], surface_pressure: [1010, 1009] },
    minutely_15: { time: ['2026-11-05T00:00', '2026-11-05T00:15'], precipitation: [0, 0.004] },
    current: { time: '2026-11-05T00:45', temperature_2m: 51, apparent_temperature: 48, weather_code: 3, is_day: 0, precipitation: 0 },
  };
  const w = P.normalizeWeather(j);
  assert.equal(w.hours.length, 2);
  assert.equal(w.hours[0].ms, Date.parse('2026-11-05T00:00:00Z'));
  assert.equal(w.hours[0].visMi, 10);
  assert.equal(w.hours[1].visMi, 1);
  assert.equal(w.hours[1].pop, null);
  assert.equal(w.minutely[1].precipIn, 0.004);
  assert.equal(w.current.isDay, false);
  const merged = C.mergeAir(w.hours, P.normalizeAir({ hourly: { time: ['2026-11-05T01:00'], us_aqi: [88], pm2_5: [20] } }));
  assert.equal(merged[0].aqi, null);
  assert.equal(merged[1].aqi, 88);
  assert.throws(() => P.normalizeWeather({}), (e) => e.kind === 'shape');
});

test('providers: NWS alerts sort by severity and keep the useful fields', () => {
  const a = P.normalizeAlerts({ features: [
    { properties: { event: 'Wind Advisory', severity: 'Minor', headline: 'h1', ends: '2026-11-05T20:00:00-05:00' } },
    { properties: { event: 'Flood Warning', severity: 'Severe', headline: 'h2', expires: '2026-11-06T00:00:00Z' } },
  ] });
  assert.equal(a[0].event, 'Flood Warning');
  assert.equal(a[1].endsMs, Date.parse('2026-11-06T01:00:00Z'));
  assert.deepEqual(P.normalizeAlerts({ features: [] }), []);
});

test('providers: place input parsing', () => {
  assert.deepEqual(P.parseLatLon('42.66, -71.15'), { lat: 42.66, lon: -71.15 });
  assert.equal(P.parseLatLon('Austin'), null);
  assert.equal(P.parseLatLon('95, 10'), null);
  assert.ok(P.zipOk('01810') && !P.zipOk('1810'));
  assert.equal(P.stateAbbr('Texas'), 'TX');
});

test('today by the hour: one row per local hour, now and past marked, sun hours found, summary says when rain comes', () => {
  const now = T0 + 13 * 3600000 + 20 * 60000; // 1:20 PM EST
  const hours = series(72, (i) => ({ feelsF: 40 + Math.min(i, 48 - i) , tempF: 40 + Math.min(i, 48 - i), pop: i >= 15 && i <= 18 ? 70 : 0, code: i >= 15 && i <= 18 ? 61 : 0 }));
  const t = C.todayHours(ANDOVER, hours, now);
  assert.equal(t.key, '2026-11-05');
  assert.equal(t.rows.length, 24);
  assert.equal(t.rows[0].label, '12 AM');
  assert.equal(t.rows.filter((r) => r.now).length, 1);
  assert.equal(t.rows.findIndex((r) => r.now), 13);
  assert.ok(t.rows.slice(0, 13).every((r) => r.past) && !t.rows[13].past);
  assert.equal(t.rows.findIndex((r) => r.sun === 'sunrise'), 6);
  assert.equal(t.rows.findIndex((r) => r.sun === 'sunset'), 16);
  assert.ok(t.rows[2].night && !t.rows[12].night && t.rows[20].night);
  assert.match(t.summary, /Rain 3 PM to 7 PM/);
  assert.match(t.summary, /^Feels coldest 53° at 1 PM, warmest 63° at 11 PM\. Rain 3 PM to 7 PM\.$/);
});

test('today summary: dry day, rain already falling, and a day with no data gaps', () => {
  const now = T0 + 9 * 3600000;
  const dry = C.todayHours(ANDOVER, series(48, () => ({})), now);
  assert.match(dry.summary, /Dry for the rest of today/);
  assert.equal(C.todayHours(ANDOVER, series(48, () => ({})), T0 + 1000).summary.includes('Dry all day.'), true);
  const wet = C.todayHours(ANDOVER, series(48, (i) => ({ pop: i >= 8 && i <= 11 ? 90 : 0, precipIn: i >= 8 && i <= 11 ? 0.1 : 0, code: 63 })), now);
  assert.match(wet.summary, /Rain until 12 PM/);
  const snow = C.todayHours(ANDOVER, series(48, (i) => ({ pop: i >= 14 && i <= 15 ? 80 : 0, code: i >= 14 && i <= 15 ? 73 : 0 })), now);
  assert.match(snow.summary, /Snow 2 PM to 4 PM/);
  const nulls = C.todayHours(ANDOVER, series(48, () => ({ feelsF: null, pop: null })), now);
  assert.ok(nulls.rows.length === 24 && typeof nulls.summary === 'string');
});

test('today by the hour on a 23-hour spring-forward day has 23 rows', () => {
  const springNow = Date.parse('2027-03-14T16:00:00Z');
  const start = C.zonedMidnight('2027-03-13', ANDOVER.tz);
  const hs = series(96, () => ({}), start);
  assert.equal(C.todayHours(ANDOVER, hs, springNow).rows.length, 23);
});

test('today summary skips the high/low sentence when the rest of the day is flat or nearly over', () => {
  const flat = C.todayHours(ANDOVER, series(48, () => ({ feelsF: 60 })), T0 + 9 * 3600000);
  assert.equal(flat.summary, 'Dry for the rest of today.');
  const late = C.todayHours(ANDOVER, series(48, (i) => ({ feelsF: 40 + i })), T0 + 21 * 3600000);
  assert.equal(late.summary, 'Dry for the rest of today.');
});

test('age label: just now, minutes, then hours', () => {
  const n = Date.parse('2026-11-05T17:00:00Z');
  assert.equal(C.ageLabel(n - 20000, n), 'just now');
  assert.equal(C.ageLabel(n - 4 * 60000, n), '4 min ago');
  assert.equal(C.ageLabel(n - 80 * 60000, n), '80 min ago');
  assert.equal(C.ageLabel(n - 150 * 60000, n), '3 h ago');
  assert.equal(C.ageLabel(n + 5000, n), 'just now');
});
