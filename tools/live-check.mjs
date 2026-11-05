// Live end-to-end check against the real APIs (no keys). Run: node tools/live-check.mjs [place ...]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../src/core.js');
const P = require('../src/providers.js');

const inputs = process.argv.slice(2).length ? process.argv.slice(2) : ['01810', '80202', '33101', '98101', 'Honolulu'];
let failures = 0;
const now = Date.now();

for (const input of inputs) {
  const t0 = Date.now();
  try {
    const [place] = await P.resolvePlaces(input);
    const [wx, aq, alerts] = await Promise.all([P.fetchWeather(place), P.fetchAir(place).catch(() => null), P.fetchAlerts(place).catch(() => null)]);
    const hours = C.mergeAir(wx.hours, aq ? aq.records : []);
    const gaps = hours.filter((h, i) => i && h.ms - hours[i - 1].ms !== 3600000).length;
    const r = C.sampleAt(hours, now), c = C.contextAt(place, hours, now);
    const story = C.feelsStory(r);
    console.log(`\n${input}  ${place.name}, ${place.state}  (${place.lat.toFixed(2)}, ${place.lon.toFixed(2)}) tz=${place.tz}  ${Date.now() - t0} ms`);
    console.log(`  hours=${hours.length} gaps=${gaps} minutely=${wx.minutely.length} aqiNull=${hours.filter((h) => h.aqi == null).length} alerts=${alerts ? alerts.length : 'n/a'}`);
    console.log(`  now: air ${Math.round(r.tempF)}F feels ${Math.round(r.feelsF)}F, ${story.headline}. ${C.vibe(r, c)}`);
    console.log(`  next: ${C.outlook(hours, place, now, 12)}  |  ${(C.nowcast(wx.minutely, now) || {}).text || 'no nowcast'}`);
    console.log(`  dress: ${C.dress(r, c).map((d) => d.label).join('; ')}`);
    for (const a of C.ACTIVITIES) { const w = C.bestWindows(place, hours, a.id, now, 1)[0]; console.log(`  ${a.label.padEnd(12)} now ${String(C.rate(a.id, r, c).score).padStart(3)}  best ${w ? C.dayLabel(w.startMs, now, place.tz) + ' ' + C.hourLabel(w.startMs, place.tz) + '-' + C.hourLabel(w.endMs, place.tz) + ' (' + w.peak + ')' : 'none this week'}`); }
    if (gaps || hours.length < 190 || !wx.minutely.length) { failures++; console.log('  FAIL: gaps or missing data'); }
  } catch (e) { failures++; console.log(`\n${input}  FAIL ${e.kind || ''} ${e.message}`); }
}
console.log(failures ? `\n${failures} failure(s)` : '\nall places OK');
process.exit(failures ? 1 : 0);
