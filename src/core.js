/* MyWeather core: pure functions, no I/O and no DOM. Works in browsers and in Node.
 * Units are US throughout (°F, mph, in, mi): the providers request them from Open-Meteo directly.
 * Time is UTC milliseconds; a place's time zone (IANA id) is only used to label and to cut days.
 * Sun position, time-zone helpers and sunrise/sunset are borrowed from ClearSky (same NOAA equations).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MyWeatherCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, f) => a + (b - a) * f;
  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  // 0 below a, ramps up to 1 at b, stays 1 until c, ramps down to 0 at d.
  const trap = (x, a, b, c, d) => (x <= a || x >= d ? 0 : x < b ? (x - a) / (b - a) : x <= c ? 1 : (d - x) / (d - c));

  /* ---------- time zones (from ClearSky) ---------- */

  const dtfCache = {};
  function dtf(tz) {
    if (!dtfCache[tz]) {
      dtfCache[tz] = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
      });
    }
    return dtfCache[tz];
  }
  function localParts(ms, tz) {
    const o = {};
    for (const p of dtf(tz || 'UTC').formatToParts(new Date(ms))) o[p.type] = p.value;
    return { date: o.year + '-' + o.month + '-' + o.day, hour: +o.hour % 24, minute: +o.minute, year: +o.year, month: +o.month, day: +o.day, weekday: o.weekday };
  }
  function tzOffsetMs(ms, tz) {
    const p = localParts(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0) - Math.floor(ms / 60000) * 60000;
  }
  // UTC ms of local midnight for 'YYYY-MM-DD' in tz (handles DST days).
  function zonedMidnight(dayKey, tz) {
    const [y, m, d] = dayKey.split('-').map(Number);
    const guess = Date.UTC(y, m - 1, d);
    let t = guess - tzOffsetMs(guess, tz);
    t = guess - tzOffsetMs(t, tz);
    return t;
  }
  function nextDayKey(dayKey) {
    const [y, m, d] = dayKey.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  const startOfDay = (ms, tz) => zonedMidnight(localParts(ms, tz).date, tz);

  function hourLabel(ms, tz) {
    const p = localParts(ms, tz);
    const h = p.hour % 12 || 12;
    return h + (p.minute ? ':' + String(p.minute).padStart(2, '0') : '') + (p.hour < 12 ? ' AM' : ' PM');
  }
  const WEEKDAYS = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
  // 'Today', 'Tomorrow', 'Yesterday' or the weekday, for the local day containing ms.
  function dayLabel(ms, nowMs, tz, long) {
    const a = localParts(ms, tz).date, b = localParts(nowMs, tz).date;
    const diff = Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    const w = localParts(ms, tz).weekday;
    return long ? WEEKDAYS[w] || w : w;
  }
  // "Now", "Today 3 PM", "Tomorrow 8 AM", "Sat 6 PM".
  function whenLabel(ms, nowMs, tz) {
    if (Math.abs(ms - nowMs) < 20 * 60000) return 'Now';
    return dayLabel(ms, nowMs, tz) + ' ' + hourLabel(Math.round(ms / HOUR) * HOUR, tz);
  }

  /* ---------- sun and moon ---------- */

  function sunPosition(lat, lon, t) {
    const ms = t instanceof Date ? t.getTime() : t;
    const rad = Math.PI / 180;
    const jd = ms / 86400000 + 2440587.5;
    const T = (jd - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
    const trueLong = L0 + C;
    const omega = 125.04 - 1934.136 * T;
    const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * rad);
    const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(omega * rad);
    const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
    const y = Math.tan((eps * rad) / 2) ** 2;
    const eqTime = (4 / rad) * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
    const d = new Date(ms);
    const minutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
    let tst = (minutes + eqTime + 4 * lon) % 1440;
    if (tst < 0) tst += 1440;
    let ha = tst / 4 - 180;
    if (ha < -180) ha += 360;
    const latR = lat * rad;
    const cosZen = clamp(Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha * rad), -1, 1);
    const zen = Math.acos(cosZen);
    let elev = 90 - zen / rad;
    const te = Math.tan(elev * rad);
    let refr = 0;
    if (elev > 85) refr = 0;
    else if (elev > 5) refr = (58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5) / 3600;
    else if (elev > -0.575) refr = (1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)))) / 3600;
    else refr = -20.772 / te / 3600;
    elev += refr;
    const sinZen = Math.sin(zen);
    let az;
    if (sinZen < 1e-6) az = 180;
    else {
      const cosAz = clamp((Math.sin(latR) * cosZen - Math.sin(decl)) / (Math.cos(latR) * sinZen), -1, 1);
      const a = Math.acos(cosAz) / rad;
      az = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
    }
    return { elevDeg: elev, azDeg: az };
  }

  // Sunrise and sunset for a local day, scanned at 5-minute steps (from ClearSky, trimmed).
  function sunTimes(lat, lon, dayKey, tz) {
    const start = zonedMidnight(dayKey, tz);
    const end = zonedMidnight(nextDayKey(dayKey), tz);
    const step = 5 * 60000;
    const out = { sunrise: null, sunset: null, goldenStart: null, maxElev: -90 };
    let prev = sunPosition(lat, lon, start).elevDeg;
    for (let t = start + step; t <= end; t += step) {
      const e = sunPosition(lat, lon, t).elevDeg;
      if (e > out.maxElev) out.maxElev = e;
      const at = (lvl) => t - step + ((lvl - prev) / (e - prev)) * step;
      if (prev < -0.833 && e >= -0.833 && out.sunrise == null) out.sunrise = at(-0.833);
      if (prev >= -0.833 && e < -0.833) out.sunset = at(-0.833);
      if (prev >= 6 && e < 6) out.goldenStart = at(6);
      prev = e;
    }
    return out;
  }

  const SYNODIC = 29.530588853;
  // Moon: ecliptic position from the low-precision series (about 0.5 degree), then horizon coordinates.
  // illum is the lit fraction 0..1; waxing is true from new to full.
  function moonState(lat, lon, ms) {
    const rad = Math.PI / 180;
    const d = ms / 86400000 + 2440587.5 - 2451545.0;
    const L = 218.316 + 13.176396 * d;
    const Mm = (134.963 + 13.064993 * d) * rad;
    const F = (93.272 + 13.22935 * d) * rad;
    const lam = (L + 6.289 * Math.sin(Mm)) * rad;
    const bet = 5.128 * Math.sin(F) * rad;
    const eps = 23.4393 * rad;
    const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(bet) * Math.sin(eps), Math.cos(lam));
    const dec = Math.asin(Math.sin(bet) * Math.cos(eps) + Math.cos(bet) * Math.sin(eps) * Math.sin(lam));
    const gst = (280.46061837 + 360.98564736629 * d) * rad;
    const H = gst + lon * rad - ra;
    const latR = lat * rad;
    const alt = Math.asin(Math.sin(latR) * Math.sin(dec) + Math.cos(latR) * Math.cos(dec) * Math.cos(H));
    const A = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(latR) - Math.tan(dec) * Math.cos(latR));
    const sunLam = (280.46 + 0.9856474 * d + 1.915 * Math.sin((357.528 + 0.9856003 * d) * rad) + 0.02 * Math.sin(2 * (357.528 + 0.9856003 * d) * rad)) * rad;
    let elong = (lam - sunLam) % (2 * Math.PI);
    if (elong < 0) elong += 2 * Math.PI;
    return { elevDeg: alt / rad, azDeg: ((A / rad + 180) % 360 + 360) % 360, illum: (1 - Math.cos(elong)) / 2, phase: elong / (2 * Math.PI), waxing: elong < Math.PI };
  }
  function moonName(phase) {
    const p = ((phase % 1) + 1) % 1;
    if (p < 0.03 || p >= 0.97) return 'New moon';
    if (p < 0.22) return 'Waxing crescent';
    if (p < 0.28) return 'First quarter';
    if (p < 0.47) return 'Waxing gibbous';
    if (p < 0.53) return 'Full moon';
    if (p < 0.72) return 'Waning gibbous';
    if (p < 0.78) return 'Last quarter';
    return 'Waning crescent';
  }

  /* ---------- weather codes ---------- */

  // WMO code -> a label and the visual kind the sky and icons use.
  function codeInfo(code) {
    const c = isNum(code) ? code : 0;
    if (c === 0) return { label: 'Clear', kind: 'clear', wet: 0 };
    if (c === 1) return { label: 'Mostly clear', kind: 'clear', wet: 0 };
    if (c === 2) return { label: 'Partly cloudy', kind: 'partly', wet: 0 };
    if (c === 3) return { label: 'Overcast', kind: 'cloudy', wet: 0 };
    if (c === 45 || c === 48) return { label: 'Fog', kind: 'fog', wet: 0 };
    if (c >= 51 && c <= 55) return { label: 'Drizzle', kind: 'rain', wet: 1 };
    if (c === 56 || c === 57) return { label: 'Freezing drizzle', kind: 'rain', wet: 1, icy: true };
    if (c === 61) return { label: 'Light rain', kind: 'rain', wet: 1 };
    if (c === 63) return { label: 'Rain', kind: 'rain', wet: 2 };
    if (c === 65) return { label: 'Heavy rain', kind: 'rain', wet: 3 };
    if (c === 66 || c === 67) return { label: 'Freezing rain', kind: 'rain', wet: 2, icy: true };
    if (c === 71) return { label: 'Light snow', kind: 'snow', wet: 1 };
    if (c === 73) return { label: 'Snow', kind: 'snow', wet: 2 };
    if (c === 75 || c === 77 || c === 86) return { label: 'Heavy snow', kind: 'snow', wet: 3 };
    if (c === 80) return { label: 'Light showers', kind: 'rain', wet: 1 };
    if (c === 81) return { label: 'Showers', kind: 'rain', wet: 2 };
    if (c === 82) return { label: 'Heavy showers', kind: 'rain', wet: 3 };
    if (c === 85) return { label: 'Snow showers', kind: 'snow', wet: 2 };
    if (c === 95) return { label: 'Thunderstorm', kind: 'thunder', wet: 3 };
    if (c >= 96) return { label: 'Thunderstorm with hail', kind: 'thunder', wet: 3 };
    return { label: 'Cloudy', kind: 'cloudy', wet: 0 };
  }

  /* ---------- sampling the hourly series at any moment ---------- */

  const NUM_FIELDS = ['tempF', 'feelsF', 'rh', 'dewF', 'pop', 'precipIn', 'snowIn', 'cloud', 'cloudLow', 'cloudMid', 'cloudHigh', 'visMi', 'windMph', 'gustMph', 'uv', 'rad', 'pressHpa', 'aqi', 'pm25'];
  const mix = (a, b, f) => (isNum(a) && isNum(b) ? lerp(a, b, f) : isNum(a) ? a : isNum(b) ? b : null);
  function circMix(a, b, f) {
    if (!isNum(a)) return isNum(b) ? b : null;
    if (!isNum(b)) return a;
    let d = ((b - a + 540) % 360) - 180;
    return (a + d * f + 360) % 360;
  }
  // Linear blend of the two surrounding hours; the weather code is the nearer hour's.
  function sampleAt(hours, ms) {
    const n = hours.length;
    if (!n) return null;
    const x = clamp((ms - hours[0].ms) / HOUR, 0, n - 1);
    const i = Math.floor(x), j = Math.min(n - 1, i + 1), f = x - i;
    const a = hours[i], b = hours[j];
    const out = { ms };
    for (const k of NUM_FIELDS) out[k] = mix(a[k], b[k], f);
    out.windDir = circMix(a.windDir, b.windDir, f);
    out.code = f < 0.5 ? a.code : b.code;
    return out;
  }
  const indexAt = (hours, ms) => clamp(Math.round((ms - hours[0].ms) / HOUR), 0, hours.length - 1);

  // Everything position-dependent about a moment: sun, moon, local hour, recent rain.
  function contextAt(place, hours, ms) {
    const sun = sunPosition(place.lat, place.lon, ms);
    const moon = moonState(place.lat, place.lon, ms);
    const lp = localParts(ms, place.tz);
    let wet = 0;
    const i = indexAt(hours, ms);
    for (let k = Math.max(0, i - 2); k <= i; k++) wet += hours[k].precipIn || 0;
    return { elev: sun.elevDeg, az: sun.azDeg, moon, moonUp: clamp(moon.elevDeg / 10, 0, 1), hour: lp.hour + lp.minute / 60, wetBefore3h: wet };
  }

  /* ---------- how it feels, in plain words ---------- */

  function feelsWord(f) {
    if (f < 0) return 'bitter';
    if (f < 20) return 'frigid';
    if (f < 32) return 'freezing';
    if (f < 45) return 'cold';
    if (f < 55) return 'chilly';
    if (f < 65) return 'cool';
    if (f < 75) return 'mild';
    if (f < 82) return 'warm';
    if (f < 90) return 'hot';
    if (f < 100) return 'sweltering';
    return 'dangerously hot';
  }
  function comfortWord(dewF) {
    if (!isNum(dewF)) return '';
    if (dewF < 40) return 'Very dry';
    if (dewF < 55) return 'Comfortable';
    if (dewF < 60) return 'A little humid';
    if (dewF < 65) return 'Sticky';
    if (dewF < 70) return 'Muggy';
    if (dewF < 75) return 'Oppressive';
    return 'Miserable';
  }

  // NWS wind chill and Rothfusz heat index, used to explain the gap between the air and how it feels.
  function windChillDelta(tempF, mph) {
    if (!isNum(tempF) || !isNum(mph) || tempF > 50 || mph < 3) return 0;
    const v = mph ** 0.16;
    return 35.74 + 0.6215 * tempF - 35.75 * v + 0.4275 * tempF * v - tempF;
  }
  function heatIndexDelta(tempF, rh) {
    if (!isNum(tempF) || !isNum(rh) || tempF < 80) return 0;
    const T = tempF, R = rh;
    const hi = -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R - 0.00683783 * T * T - 0.05481717 * R * R + 0.00122874 * T * T * R + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    return Math.max(0, hi - T);
  }
  // [{kind, delta, text}] for the biggest reasons feels differs from the thermometer.
  function feelsDrivers(r) {
    const out = [];
    if (!r || !isNum(r.tempF) || !isNum(r.feelsF)) return out;
    const total = r.feelsF - r.tempF;
    const wind = windChillDelta(r.tempF, r.windMph);
    const heat = heatIndexDelta(r.tempF, r.rh);
    if (wind <= -2) out.push({ kind: 'wind', delta: wind, text: 'Wind takes ' + Math.round(-wind) + '° off' });
    if (heat >= 2) out.push({ kind: 'humidity', delta: heat, text: 'Humidity adds ' + Math.round(heat) + '°' });
    const rest = total - wind - heat;
    if (rest >= 2 && (r.rad || 0) >= 300) out.push({ kind: 'sun', delta: rest, text: 'Sunshine adds ' + Math.round(rest) + '°' });
    else if (rest <= -2 && r.tempF >= 65 && (r.windMph || 0) >= 6) out.push({ kind: 'breeze', delta: rest, text: 'The breeze takes ' + Math.round(-rest) + '° off' });
    return out;
  }

  function feelsStory(r) {
    const word = feelsWord(r.feelsF);
    const tags = [];
    if ((r.precipIn || 0) >= 0.01 || (r.snowIn || 0) > 0) tags.push((r.snowIn || 0) > 0 || r.tempF <= 32 ? 'snowy' : 'wet');
    else if (isNum(r.visMi) && r.visMi < 1.5) tags.push('foggy');
    if ((r.gustMph || 0) >= 28 || (r.windMph || 0) >= 18) tags.push('windy');
    else if ((r.windMph || 0) >= 11) tags.push('breezy');
    if ((r.dewF || 0) >= 65 && r.tempF >= 70) tags.push('muggy');
    else if ((r.dewF || 99) < 30 && r.tempF > 40) tags.push('dry');
    if ((r.rad || 0) >= 600 && (r.cloud || 0) < 40) tags.push('sunny');
    else if ((r.cloud || 0) >= 90 && (r.rad || 0) < 250 && !tags.length) tags.push('grey');
    const t = tags.slice(0, 2);
    const cap = word[0].toUpperCase() + word.slice(1);
    return { word, tags: t, headline: cap + (t.length === 1 ? ' and ' + t[0] : t.length === 2 ? ', ' + t[0] + ' and ' + t[1] : ''), drivers: feelsDrivers(r), delta: r.feelsF - r.tempF };
  }

  // One evocative sentence. Rules run top to bottom; the first that fits wins, so order is severity.
  function vibe(r, c) {
    const f = r.feelsF, dark = c && c.elev < -3, dawn = c && c.elev >= -3 && c.elev < 8 && c.hour < 12, dusk = c && c.elev >= -3 && c.elev < 8 && c.hour >= 12;
    const info = codeInfo(r.code);
    if (info.kind === 'thunder') return 'Keep an ear out. Thunder is in the air, so stay close to shelter.';
    if (info.kind === 'snow' && (r.windMph || 0) < 12) return 'Soft and quiet. Snow muffles everything.';
    if (info.kind === 'snow') return 'Snow on the wind. It comes sideways and stings.';
    if (info.icy) return 'Ice glazes everything. Slow down, walk like a penguin.';
    if (info.kind === 'rain' && info.wet >= 3) return 'Hard rain drumming on the roof. Not a day to be caught out.';
    if (info.kind === 'rain') return (r.windMph || 0) > 14 ? 'Wet and wind-driven. An umbrella will turn inside out.' : 'A steady, quiet drizzle. The kind that rinses the air clean.';
    if (info.kind === 'fog' || (isNum(r.visMi) && r.visMi < 1)) return 'Fog has muffled the world. Everything looks softer and closer.';
    if (f >= 100) return 'Heat that presses on you. Find shade, water and air conditioning.';
    if (f >= 90 && (r.dewF || 0) >= 65) return 'Air you can almost wear. Everything sticks, so move slowly.';
    if (f >= 88) return 'Hot and bright. Shade is the best feature of the day.';
    if (f >= 80 && (r.dewF || 0) >= 65) return 'Warm and thick with humidity. It is a porch-and-iced-drink kind of weather.';
    if (f <= 5) return 'Bitter. Skin feels it in minutes, so cover every inch.';
    if (f <= 20 && (r.windMph || 0) >= 12) return 'The wind finds every gap in your coat.';
    if (f <= 32) return 'Hard cold. Your breath hangs in the air.';
    if (f <= 45 && (r.windMph || 0) >= 14) return 'Raw and blustery. Cold that gets under your collar.';
    if (dark && f < 55) return 'Cool, quiet night air. Good for sleeping with the window cracked, if you like it brisk.';
    if (dark) return 'A soft night. The air is gentle and still.';
    if (f <= 45) return 'Cold and clear-headed. Hats-and-hot-drinks weather.';
    if (f < 60 && (r.cloud || 0) < 40 && (r.dewF || 50) < 45) return 'Crisp and bright. A proper fall day.';
    if (f < 60) return 'Cool and calm. A sweater will do.';
    if (f < 72 && (r.cloud || 0) < 40 && (r.dewF || 50) < 55) return 'The kind of day you leave the windows open.';
    if (f < 72 && !dusk && (r.rad || 0) < 250 && (r.cloud || 0) >= 80) return 'Mild and overcast, with soft light and no glare.';
    if (f < 72) return 'Easy, mild air. Nothing to fight.';
    if (dusk) return 'Warm and golden. The day is winding down gently.';
    if (dawn) return 'Fresh and quiet, and the day is just waking up.';
    if (f < 82) return 'Warm and easy. T-shirts and long afternoons.';
    return 'Properly warm. Plan around the shade.';
  }

  /* ---------- what to wear and bring ---------- */

  function dress(r, c) {
    const out = [];
    const f = r.feelsF, day = !c || c.elev > 0;
    const info = codeInfo(r.code);
    const wet = (r.pop || 0) >= 45 || (r.precipIn || 0) >= 0.02 || info.wet > 0;
    const snow = info.kind === 'snow' || (r.snowIn || 0) > 0;
    const add = (id, label, why) => out.push({ id, label, why });
    if (f <= 10) add('layers', 'Heavy coat, hat, gloves', 'Feels ' + Math.round(f) + '°');
    else if (f <= 25) add('layers', 'Winter coat, hat, gloves', 'Feels ' + Math.round(f) + '°');
    else if (f <= 38) add('layers', 'Warm coat and a hat', 'Feels ' + Math.round(f) + '°');
    else if (f <= 50) add('layers', 'Coat over a layer', 'Feels ' + Math.round(f) + '°');
    else if (f <= 60) add('layers', 'Light jacket or fleece', 'Feels ' + Math.round(f) + '°');
    else if (f <= 68) add('layers', 'Long sleeves', 'Feels ' + Math.round(f) + '°');
    else if (f <= 78) add('layers', 'T-shirt weather', 'Feels ' + Math.round(f) + '°');
    else if (f <= 88) add('layers', 'Light, breathable clothes', 'Feels ' + Math.round(f) + '°');
    else add('layers', 'Shorts, hat, water bottle', 'Feels ' + Math.round(f) + '°');
    if (wet) add('wet', snow ? 'Boots and a waterproof layer' : 'Umbrella or rain jacket', snow ? 'Snow expected' : Math.round(r.pop || 0) + '% chance of rain');
    if ((r.gustMph || 0) >= 25 && !wet) add('wind', 'Windbreaker', 'Gusts to ' + Math.round(r.gustMph) + ' mph');
    if (day && (r.uv || 0) >= 6) add('sun', 'Sunscreen and sunglasses', 'UV ' + Math.round(r.uv));
    else if (day && (r.uv || 0) >= 3 && (r.cloud || 0) < 70) add('sun', 'Sunglasses', 'UV ' + Math.round(r.uv));
    if ((r.aqi || 0) >= 101) add('air', 'Go easy outdoors', 'Air quality ' + Math.round(r.aqi) + (r.aqi >= 151 ? ': unhealthy for everyone' : ': sensitive lungs, take care'));
    if (r.tempF >= 85 && day && (r.rad || 0) >= 400) add('pets', 'Pets: pavement is hot', 'Asphalt can be far hotter than the air');
    else if (f <= 15) add('pets', 'Pets: keep walks short', 'Paws and ears get cold fast');
    return out;
  }

  /* ---------- "ask the sky": how good is this hour for what you want to do ---------- */

  const comfyF = (r, a, b, c, d) => [r.feelsF < (b + c) / 2 ? 'Too cold' : 'Too hot', trap(r.feelsF, a, b, c, d)];
  const dryF = (r) => {
    const info = codeInfo(r.code);
    const wet = Math.max(((r.pop || 0) / 100) * 0.9, (r.precipIn || 0) * 14, (r.snowIn || 0) * 10, info.wet ? 0.5 : 0);
    return [info.kind === 'snow' ? 'Snow' : 'Rain likely', 1 - clamp(wet, 0, 1)];
  };
  const windF = (r, lo, hi) => ['Too windy', 1 - clamp((Math.max(r.windMph || 0, (r.gustMph || 0) * 0.65) - lo) / (hi - lo), 0, 1)];
  const lightF = (c, dusk) => ['Dark', c.elev >= 0 ? 1 : clamp((c.elev + (dusk ? 8 : 2)) / (dusk ? 8 : 2), 0, 1)];
  const airF = (r) => ['Smoky air', !isNum(r.aqi) || r.aqi <= 50 ? 1 : r.aqi <= 100 ? 0.8 : r.aqi <= 150 ? 0.35 : 0.1];
  const stormF = (r) => ['Thunderstorms', r.code >= 95 ? 0 : 1];

  const ACTIVITIES = [
    { id: 'walk', label: 'Walk', good: 'Mild, dry and easy', factors: (r, c) => [comfyF(r, 30, 50, 78, 92), dryF(r), windF(r, 14, 30), lightF(c, true), airF(r), stormF(r)] },
    { id: 'run', label: 'Run', good: 'Cool, dry air to run in', factors: (r, c) => [comfyF(r, 15, 35, 62, 80), dryF(r), windF(r, 18, 35), lightF(c, true), airF(r), ['Muggy', 1 - clamp(((r.dewF || 0) - 60) / 15, 0, 1) * 0.8], stormF(r)] },
    { id: 'play', label: 'Playground', good: 'Dry, mild and sunny enough for kids', factors: (r, c) => [comfyF(r, 45, 60, 82, 92), dryF(r), ['Wet slides', c.wetBefore3h > 0.02 ? 0.5 : 1], windF(r, 15, 30), lightF(c, false), ['Strong sun', 1 - clamp(((r.uv || 0) - 7) / 5, 0, 1) * 0.5], airF(r), stormF(r)] },
    { id: 'bike', label: 'Bike', good: 'Calm and dry for riding', factors: (r, c) => [comfyF(r, 38, 55, 82, 95), dryF(r), windF(r, 10, 25), lightF(c, true), airF(r), stormF(r)] },
    { id: 'grill', label: 'Grill', good: 'Dry and calm for cooking outside', factors: (r, c) => [comfyF(r, 30, 50, 95, 105), dryF(r), windF(r, 12, 28), ['Late', trap(c.hour, 9, 11.5, 20, 22.5)], stormF(r)] },
    { id: 'laundry', label: 'Laundry line', good: 'Dry, breezy and bright', factors: (r, c) => [['Too humid to dry', trap((r.tempF || 0) - (r.dewF || 0), 4, 18, 200, 300)], ['Too cold to dry', clamp(((r.tempF || 0) - 30) / 25, 0, 1)], ['Rain likely', 1 - clamp(((r.pop || 0) / 100) / 0.5, 0, 1)], ['Not enough sun', 0.4 + 0.6 * clamp((r.rad || 0) / 450, 0, 1)], ['Wrong time of day', trap(c.hour, 7.5, 10, 15, 18)], dryF(r)] },
    { id: 'stars', label: 'Stargazing', good: 'Dark, clear sky', factors: (r, c) => [['Not dark yet', clamp((-c.elev - 6) / 12, 0, 1)], ['Cloudy', 1 - clamp((r.cloud || 0) / 55, 0, 1)], ['Bright moon', 1 - c.moonUp * c.moon.illum * 0.75], ['Too cold', trap(r.feelsF, 5, 28, 120, 130)], ['Hazy', isNum(r.visMi) ? clamp(r.visMi / 8, 0.3, 1) : 1], stormF(r)] },
    { id: 'pool', label: 'Pool day', good: 'Warm, dry and sunny', factors: (r, c) => [['Too cool', trap(r.feelsF, 70, 80, 98, 108)], dryF(r), lightF(c, false), windF(r, 18, 32), stormF(r)] },
  ];
  const ACT_BY_ID = Object.fromEntries(ACTIVITIES.map((a) => [a.id, a]));

  // { score 0..100, label, why } for one sampled moment. why is the weakest factor when it matters, else the good line.
  function rate(actId, r, c) {
    const act = ACT_BY_ID[actId];
    if (!act || !r) return null;
    const fs = act.factors(r, c);
    let min = 1, worst = null, sum = 0;
    for (const [name, v] of fs) { sum += v; if (v < min) { min = v; worst = name; } }
    let score = 100 * (0.55 * min + 0.45 * (sum / fs.length));
    if (min < 0.05) score = Math.min(score, 20);
    score = Math.round(clamp(score, 0, 100));
    const label = score >= 80 ? 'Great' : score >= 65 ? 'Good' : score >= 45 ? 'Fair' : 'Poor';
    return { score, label, why: min < 0.7 ? worst : act.good };
  }

  // Scores for every hour in the series.
  function scoreSeries(place, hours, actId) {
    return hours.map((h) => rate(actId, h, contextAt(place, hours, h.ms)).score);
  }

  // Best window per local day from fromMs on, strongest first. A window is the run of hours around the day's peak that
  // stay within 10 points of it (and at least 60).
  function bestWindows(place, hours, actId, fromMs, limit) {
    const scores = scoreSeries(place, hours, actId);
    const byDay = new Map();
    hours.forEach((h, i) => {
      if (h.ms + HOUR <= fromMs) return;
      const k = localParts(h.ms, place.tz).date;
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(i);
    });
    const out = [];
    for (const [day, idx] of byDay) {
      let pk = idx[0];
      for (const i of idx) if (scores[i] > scores[pk]) pk = i;
      const peak = scores[pk];
      if (peak < 55) continue;
      const thr = Math.max(60, peak - 10);
      let a = idx.indexOf(pk), b = a;
      while (a > 0 && scores[idx[a - 1]] >= thr) a--;
      while (b < idx.length - 1 && scores[idx[b + 1]] >= thr) b++;
      let sum = 0;
      for (let k = a; k <= b; k++) sum += scores[idx[k]];
      out.push({ day, startMs: hours[idx[a]].ms, endMs: hours[idx[b]].ms + HOUR, peak, avg: Math.round(sum / (b - a + 1)), peakMs: hours[pk].ms });
    }
    out.sort((x, y) => y.peak - x.peak || x.startMs - y.startMs);
    return out.slice(0, limit || 3);
  }

  /* ---------- what is coming next ---------- */

  // One sentence on the next several hours from ms: rain arriving or leaving, a swing in temperature, gusts.
  function outlook(hours, place, ms, horizonH) {
    const H = horizonH || 12, tz = place.tz;
    const i0 = indexAt(hours, ms);
    const seg = hours.slice(i0, Math.min(hours.length, i0 + H + 1));
    if (seg.length < 3) return '';
    const wetHour = (h) => (h.precipIn || 0) >= 0.01 || codeInfo(h.code).wet > 0;
    const snowy = (h) => codeInfo(h.code).kind === 'snow' || (h.snowIn || 0) > 0;
    const nowWet = wetHour(seg[0]);
    const kind = (h) => (snowy(h) ? 'Snow' : 'Rain');
    if (nowWet) {
      const dry = seg.findIndex((h, k) => k > 0 && !wetHour(h) && (seg[k + 1] ? !wetHour(seg[k + 1]) : true));
      if (dry > 0) return kind(seg[0]) + ' eases around ' + hourLabel(seg[dry].ms, tz) + '.';
      return kind(seg[0]) + ' sticks around for the next ' + (seg.length - 1) + ' hours.';
    }
    const wet = seg.findIndex((h) => wetHour(h) && (h.pop == null || h.pop >= 35 || (h.precipIn || 0) >= 0.03));
    if (wet > 0) {
      const end = seg.findIndex((h, k) => k > wet && !wetHour(h));
      return kind(seg[wet]) + ' arrives around ' + hourLabel(seg[wet].ms, tz) + (end > 0 ? ' and clears by ' + hourLabel(seg[end].ms, tz) + '.' : ', and stays for hours.');
    }
    let hi = seg[0], lo = seg[0];
    for (const h of seg) { if (h.feelsF > hi.feelsF) hi = h; if (h.feelsF < lo.feelsF) lo = h; }
    const d0 = seg[0].feelsF;
    if (hi.feelsF - d0 >= 8 && hi.ms > seg[0].ms) return 'Warming to ' + Math.round(hi.feelsF) + '° by ' + hourLabel(hi.ms, tz) + '.';
    if (d0 - lo.feelsF >= 8 && lo.ms > seg[0].ms) return 'Cooling to ' + Math.round(lo.feelsF) + '° by ' + hourLabel(lo.ms, tz) + '.';
    const gust = seg.reduce((m, h) => (h.gustMph > m.gustMph ? h : m), seg[0]);
    if ((gust.gustMph || 0) >= 25 && gust.gustMph - (seg[0].gustMph || 0) >= 8) return 'Gusts up to ' + Math.round(gust.gustMph) + ' mph around ' + hourLabel(gust.ms, tz) + '.';
    return 'Steady for the next ' + (seg.length - 1) + ' hours.';
  }

  // Same hour yesterday vs this moment, on the "feels like" scale.
  function vsYesterday(hours, ms) {
    if (!hours.length || ms - DAY < hours[0].ms) return null;
    const a = sampleAt(hours, ms), b = sampleAt(hours, ms - DAY);
    if (!a || !b || !isNum(a.feelsF) || !isNum(b.feelsF)) return null;
    const d = Math.round(a.feelsF - b.feelsF);
    if (Math.abs(d) < 3) return 'About the same as yesterday.';
    return Math.abs(d) + '° ' + (d > 0 ? 'warmer' : 'cooler') + ' than the same time yesterday.';
  }

  // Minute-level rain countdown from 15-minute totals [{ms, precipIn}] (inches per 15 minutes).
  function nowcast(minutely, nowMs, opts) {
    const o = opts || {};
    const word = o.snow ? 'Snow' : 'Rain';
    const slots = (minutely || []).filter((m) => m.ms + 900000 > nowMs);
    if (!slots.length) return null;
    const wet = (m) => (m.precipIn || 0) >= 0.004;
    const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);
    const span = (m) => (m < 90 ? 'about ' + round5(m) + ' min' : 'about ' + (Math.round((m / 60) * 2) / 2) + ' hours');
    if (wet(slots[0])) {
      const k = slots.findIndex((m) => !wet(m));
      if (k < 0) return { state: 'raining', text: word + ' now, and it is not letting up for the next ' + Math.round((slots.length * 15) / 60) + '+ hours.' };
      return { state: 'raining', endsMin: round5((slots[k].ms - nowMs) / 60000), text: word + ' now, easing in ' + span((slots[k].ms - nowMs) / 60000) + '.' };
    }
    const k = slots.findIndex(wet);
    if (k < 0) return { state: 'dry', text: 'No ' + word.toLowerCase() + ' in the next ' + Math.round((slots.length * 15) / 60) + ' hours.' };
    let n = 0;
    while (k + n < slots.length && wet(slots[k + n])) n++;
    const startMin = round5(Math.max(0, (slots[k].ms - nowMs) / 60000));
    return { state: 'soon', startMin, text: word + ' starts in ' + span(Math.max(0, (slots[k].ms - nowMs) / 60000)) + (k + n < slots.length ? ', lasting ' + span(n * 15) + '.' : ', and keeps going.') };
  }

  /* ---------- the sunset ---------- */

  // How colorful tonight's sunset is likely to be, from the cloud layers at the horizon.
  function sunsetQuality(r) {
    if (!r) return null;
    const canvas = trap(Math.max(r.cloudHigh || 0, r.cloudMid || 0), 8, 35, 70, 98);
    const lowCloud = r.cloudLow || 0;
    const blocked = lowCloud >= 45 ? clamp((lowCloud - 40) / 50, 0, 1) : 0;
    const wet = clamp(((r.pop || 0) / 100) * 0.6 + (r.precipIn || 0) * 10, 0, 1);
    let s = (0.3 + 0.7 * canvas) * (1 - 0.85 * blocked) * (1 - wet);
    if (isNum(r.visMi) && r.visMi < 3) s *= 0.8;
    const score = Math.round(clamp(s, 0, 1) * 100);
    const label = score >= 72 ? 'Could be vivid' : score >= 50 ? 'Pretty' : score >= 32 ? 'Soft' : 'Flat';
    const why = blocked > 0.4 ? 'Low cloud hides the horizon.' : wet > 0.4 ? 'Rain in the way.' : canvas > 0.6 ? 'Mid and high clouds to catch the color.' : canvas < 0.15 ? 'Few clouds, so a clean gradient and little drama.' : 'Some cloud to catch the light.';
    return { score, label, why };
  }

  /* ---------- grouping into local days ---------- */

  function groupDays(hours, tz) {
    const days = new Map();
    for (const h of hours) {
      const k = localParts(h.ms, tz).date;
      if (!days.has(k)) days.set(k, { key: k, startMs: zonedMidnight(k, tz), hours: [] });
      days.get(k).hours.push(h);
    }
    return [...days.values()].map((d) => {
      const hs = d.hours;
      const temps = hs.map((h) => h.tempF).filter(isNum);
      const day = hs.filter((h) => { const p = localParts(h.ms, tz); return p.hour >= 7 && p.hour <= 20; });
      const use = day.length ? day : hs;
      const sev = (h) => { const k = codeInfo(h.code).kind; return k === 'thunder' ? 5 : k === 'snow' ? 4 : k === 'rain' ? 3 : k === 'fog' ? 2 : 1; };
      let code = null;
      for (const s of [5, 4, 3]) {
        const m = use.filter((h) => sev(h) === s);
        if (m.length >= 3) { code = m[Math.floor(m.length / 2)].code; break; }
      }
      if (code == null) {
        const cloud = use.reduce((a, h) => a + (h.cloud || 0), 0) / use.length;
        code = cloud < 20 ? 0 : cloud < 45 ? 1 : cloud < 70 ? 2 : 3;
      }
      return {
        key: d.key, startMs: d.startMs, weekday: localParts(d.startMs + 6 * HOUR, tz).weekday, hi: temps.length ? Math.max(...temps) : null, lo: temps.length ? Math.min(...temps) : null,
        pop: Math.max(...hs.map((h) => h.pop || 0)), precipIn: hs.reduce((a, h) => a + (h.precipIn || 0), 0), code, n: hs.length,
      };
    });
  }

  // The local day containing nowMs, hour by hour: one row per hour with what the strip needs, plus a one-line summary.
  // Rows: ms, label, tempF, feelsF, pop, precipIn, code, night, past (hour already over), now (hour containing nowMs),
  // sun ('sunrise' | 'sunset' | null: the hour in which the sun crosses the horizon).
  const WET_POP = 40;
  const isWetHour = (h) => (h.pop || 0) >= WET_POP || (h.precipIn || 0) >= 0.01;
  function todayHours(place, hours, nowMs) {
    const tz = place.tz;
    const key = localParts(nowMs, tz).date;
    const d0 = zonedMidnight(key, tz), d1 = zonedMidnight(nextDayKey(key), tz);
    const st = sunTimes(place.lat, place.lon, key, tz);
    const hourOf = (ms) => (ms ? Math.floor((ms - d0) / HOUR) : -1);
    const rise = hourOf(st.sunrise), set = hourOf(st.sunset);
    const rows = hours.filter((h) => h.ms >= d0 && h.ms < d1).map((h) => ({
      ms: h.ms, label: hourLabel(h.ms, tz), tempF: h.tempF, feelsF: h.feelsF, pop: h.pop || 0, precipIn: h.precipIn || 0, code: h.code,
      night: sunPosition(place.lat, place.lon, h.ms + HOUR / 2).elevDeg < -0.83,
      past: h.ms + HOUR <= nowMs, now: h.ms <= nowMs && nowMs < h.ms + HOUR,
      sun: hourOf(h.ms) === rise ? 'sunrise' : hourOf(h.ms) === set ? 'sunset' : null,
    }));
    return { key, rows, summary: todaySummary(rows, tz) };
  }
  // "Warmest 58° at 2 PM, coldest 41° at 6 AM. Rain 3 PM to 7 PM." Only the rest of the day (and the current hour) is described.
  function todaySummary(rows, tz) {
    const left = rows.filter((r) => !r.past);
    const use = left.length ? left : rows;
    if (!use.length) return '';
    const withF = use.filter((r) => isNum(r.feelsF));
    let out = '';
    if (withF.length > 3) {
      const hi = withF.reduce((a, r) => (r.feelsF > a.feelsF ? r : a)), lo = withF.reduce((a, r) => (r.feelsF < a.feelsF ? r : a));
      const f = (r) => Math.round(r.feelsF) + '° at ' + r.label;
      if (hi.feelsF - lo.feelsF >= 4) out = (hi.ms < lo.ms ? 'Feels warmest ' + f(hi) + ', coldest ' + f(lo) : 'Feels coldest ' + f(lo) + ', warmest ' + f(hi)) + '. ';
    }
    const runs = [];
    for (const r of use) {
      const last = runs[runs.length - 1];
      if (!isWetHour(r)) continue;
      if (last && r.ms - last.end <= HOUR) last.end = r.ms + HOUR; else runs.push({ start: r.ms, end: r.ms + HOUR, kind: codeInfo(r.code).kind === 'snow' ? 'Snow' : 'Rain' });
    }
    if (!runs.length) out += left.length === rows.length ? 'Dry all day.' : 'Dry for the rest of today.';
    else {
      const first = runs[0], now = use[0];
      const span = (x) => hourLabel(x.start, tz) + ' to ' + hourLabel(x.end, tz);
      out += runs.length > 2 ? first.kind + ' on and off, starting ' + hourLabel(first.start, tz) + '.' : runs.map((x) => (first.start <= now.ms && x === first ? x.kind + ' until ' + hourLabel(x.end, tz) : x.kind + ' ' + span(x))).join(', then ') + '.';
    }
    return out.trim();
  }

  // How old a reading is, in words: "just now", "4 min ago", "2 h ago".
  function ageLabel(atMs, nowMs) {
    const m = Math.max(0, Math.round((nowMs - atMs) / 60000));
    return m < 1 ? 'just now' : m < 90 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
  }

  function mergeAir(hours, air) {
    const m = new Map((air || []).map((a) => [a.ms, a]));
    return hours.map((h) => { const a = m.get(h.ms); return a ? Object.assign({}, h, { aqi: a.aqi, pm25: a.pm25 }) : h; });
  }

  // Which way the barometer is heading: the 3-hour change.
  function pressureTrend(hours, ms) {
    if (!hours.length) return null;
    const a = sampleAt(hours, ms), b = sampleAt(hours, ms - 3 * HOUR);
    if (!a || !b || !isNum(a.pressHpa) || !isNum(b.pressHpa)) return null;
    const d = a.pressHpa - b.pressHpa;
    return { delta: d, word: d > 1 ? 'Rising' : d < -1 ? 'Falling' : 'Steady', inHg: a.pressHpa * 0.02953 };
  }

  const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const dirName = (deg) => (isNum(deg) ? COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] : '');
  const aqiWord = (a) => (!isNum(a) ? '' : a <= 50 ? 'Good' : a <= 100 ? 'Moderate' : a <= 150 ? 'Unhealthy for sensitive groups' : a <= 200 ? 'Unhealthy' : 'Very unhealthy');
  const uvWord = (u) => (!isNum(u) ? '' : u < 3 ? 'Low' : u < 6 ? 'Moderate' : u < 8 ? 'High' : u < 11 ? 'Very high' : 'Extreme');

  return {
    isNum, clamp, lerp, trap, HOUR, DAY,
    localParts, tzOffsetMs, zonedMidnight, nextDayKey, startOfDay, hourLabel, dayLabel, whenLabel,
    sunPosition, sunTimes, moonState, moonName, codeInfo,
    sampleAt, indexAt, contextAt, circMix,
    feelsWord, comfortWord, windChillDelta, heatIndexDelta, feelsDrivers, feelsStory, vibe, dress,
    ACTIVITIES, rate, scoreSeries, bestWindows,
    outlook, vsYesterday, nowcast, sunsetQuality, groupDays, todayHours, ageLabel, mergeAir, pressureTrend, dirName, aqiWord, uvWord,
  };
});
