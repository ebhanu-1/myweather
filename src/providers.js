/* MyWeather providers: network adapters that emit normalized records (US units, UTC ms).
 * Borrowed from ClearSky (http with timeout and retry, typed ProviderError, localStorage cache with stale fallback,
 * Zippopotam and Nominatim place lookup); the weather calls are new. Imports nothing from core.
 * Works in browsers and in Node 18+ (global fetch). No keys, no proxy: every host answers cross-origin (see ClearSky docs/spikes.md).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MyWeatherProviders = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

  class ProviderError extends Error {
    constructor(kind, message, status) {
      super(message);
      this.name = 'ProviderError';
      this.kind = kind; // timeout | rate-limit | http | shape | network
      this.status = status || null;
    }
  }

  /* ---------- cache (localStorage when present, memory otherwise) ---------- */

  const mem = new Map();
  const hasLS = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  const cache = {
    get(key, ttlMs) {
      let raw = null;
      try { raw = hasLS() ? localStorage.getItem('mw:' + key) : mem.get(key) || null; } catch (e) { raw = mem.get(key) || null; }
      if (!raw) return null;
      try {
        const o = JSON.parse(raw);
        if (ttlMs != null && Date.now() - o.at > ttlMs) return null;
        return o;
      } catch (e) { return null; }
    },
    set(key, value) {
      const raw = JSON.stringify({ at: Date.now(), v: value });
      try { if (hasLS()) localStorage.setItem('mw:' + key, raw); else mem.set(key, raw); } catch (e) { mem.set(key, raw); }
    },
  };

  /* ---------- http ---------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return u; } }

  // 8 s timeout per request; 429 and 5xx retry after 1, 2, 4 s, then throw so callers fall back to cache.
  async function http(url, opts) {
    const o = Object.assign({ timeoutMs: 8000, retries: 3, as: 'json', headers: undefined }, opts || {});
    let lastErr;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ProviderError('network', 'You are offline');
    for (let attempt = 0; attempt <= o.retries; attempt++) {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), o.timeoutMs) : null;
      try {
        const res = await fetch(url, { signal: ctl ? ctl.signal : undefined, headers: o.headers });
        if (timer) clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new ProviderError(res.status === 429 ? 'rate-limit' : 'http', 'HTTP ' + res.status + ' from ' + hostOf(url), res.status);
          if (attempt < o.retries) { await sleep(1000 * 2 ** attempt); continue; }
          throw lastErr;
        }
        if (!res.ok) throw new ProviderError('http', 'HTTP ' + res.status + ' from ' + hostOf(url), res.status);
        try { return o.as === 'text' ? await res.text() : await res.json(); }
        catch (e) { throw new ProviderError('shape', 'Unreadable response from ' + hostOf(url)); }
      } catch (e) {
        if (timer) clearTimeout(timer);
        if (e instanceof ProviderError) throw e;
        const timedOut = e && e.name === 'AbortError';
        lastErr = new ProviderError(timedOut ? 'timeout' : 'network', timedOut ? 'Timed out calling ' + hostOf(url) : 'Network error calling ' + hostOf(url));
        if (attempt < Math.min(o.retries, 1) && !timedOut) { await sleep(1000); continue; }
        throw lastErr;
      }
    }
    throw lastErr;
  }

  async function cachedJson(key, ttlMs, url, opts) {
    const hit = cache.get(key, ttlMs);
    if (hit) return { json: hit.v, at: hit.at, fromCache: true };
    try {
      const json = await http(url, opts);
      cache.set(key, json);
      return { json, at: Date.now(), fromCache: false };
    } catch (e) {
      const stale = cache.get(key, null);
      if (stale) return { json: stale.v, at: stale.at, fromCache: true, stale: true, error: e };
      throw e;
    }
  }

  /* ---------- places ---------- */

  const zipOk = (z) => /^\d{5}$/.test(String(z).trim());

  function parseLatLon(s) {
    const m = String(s).trim().match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }

  // Zippopotam.us first (CORS, keyless), Nominatim when it has no record for the zip.
  async function geocodeZip(zip) {
    zip = String(zip).trim();
    if (!zipOk(zip)) throw new ProviderError('shape', 'Enter a 5-digit US zip code, a city name, or "lat, lon".');
    const hit = cache.get('zip:' + zip, null);
    if (hit) return hit.v;
    let place = null;
    try {
      const j = await http('https://api.zippopotam.us/us/' + zip, { retries: 1 });
      const p = j && j.places && j.places[0];
      if (!p) throw new ProviderError('shape', 'Zippopotam returned no places');
      place = { zip, lat: +p.latitude, lon: +p.longitude, name: p['place name'], state: p['state abbreviation'] };
    } catch (e) { /* fall through to Nominatim */ }
    if (!place) {
      const j = await http('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&addressdetails=1&postalcode=' + zip, { retries: 1 });
      if (!Array.isArray(j) || !j.length) throw new ProviderError('shape', 'No place found for zip ' + zip + '. Try a city name.');
      const a = j[0].address || {};
      place = {
        zip, lat: +j[0].lat, lon: +j[0].lon,
        name: a.city || a.town || a.village || a.county || String(j[0].display_name || zip).split(',')[1] || zip,
        state: a['ISO3166-2-lvl4'] ? a['ISO3166-2-lvl4'].replace('US-', '') : a.state || '',
      };
    }
    cache.set('zip:' + zip, place);
    return place;
  }

  async function reverseName(lat, lon) {
    try {
      const j = await http('https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&addressdetails=1&lat=' + lat + '&lon=' + lon, { retries: 0, timeoutMs: 5000 });
      const a = (j && j.address) || {};
      return { name: a.city || a.town || a.village || a.county || null, state: a['ISO3166-2-lvl4'] ? a['ISO3166-2-lvl4'].replace('US-', '') : a.state || '' };
    } catch (e) { return { name: null, state: '' }; }
  }

  // Time zone id (and elevation) for a coordinate, via a tiny Open-Meteo call.
  async function resolveTimezone(lat, lon) {
    const key = 'tz:' + lat.toFixed(2) + ',' + lon.toFixed(2);
    const hit = cache.get(key, null);
    if (hit) return hit.v;
    const j = await http('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&daily=sunrise&forecast_days=1&timezone=auto', { retries: 1 });
    if (!j || !j.timezone) throw new ProviderError('shape', 'No time zone in response');
    const v = { tz: j.timezone, elevM: isNum(j.elevation) ? j.elevation : 0 };
    cache.set(key, v);
    return v;
  }

  // Open-Meteo place search by name (worldwide). Returns up to 5 places, timezone included.
  async function searchPlaces(name) {
    const q = String(name).trim();
    if (q.length < 2) return [];
    const j = await http('https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=' + encodeURIComponent(q), { retries: 1 });
    return ((j && j.results) || []).map((r) => ({
      name: r.name, state: r.country_code === 'US' ? stateAbbr(r.admin1) : r.admin1 || r.country || '', country: r.country_code || '',
      lat: r.latitude, lon: r.longitude, tz: r.timezone, elevM: isNum(r.elevation) ? r.elevation : 0,
    }));
  }
  const STATES = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'District of Columbia': 'DC' };
  const stateAbbr = (n) => STATES[n] || n || '';

  // Zip, "lat, lon" or a place name -> [Place with tz]. A zip or coordinate gives one place; a name gives up to five.
  async function resolvePlaces(input) {
    const s = String(input).trim();
    if (!s) throw new ProviderError('shape', 'Enter a zip code, a city, or "lat, lon".');
    const ll = parseLatLon(s);
    let place;
    if (ll) {
      const rn = await reverseName(ll.lat, ll.lon);
      place = { zip: null, lat: ll.lat, lon: ll.lon, name: rn.name || ll.lat.toFixed(2) + ', ' + ll.lon.toFixed(2), state: rn.state };
    } else if (zipOk(s)) place = await geocodeZip(s);
    else {
      const r = await searchPlaces(s);
      if (!r.length) throw new ProviderError('shape', 'No place found for "' + s + '". Try a zip code or add the state.');
      return r;
    }
    const t = await resolveTimezone(place.lat, place.lon);
    return [Object.assign({}, place, { tz: t.tz, elevM: t.elevM })];
  }

  /* ---------- forecast ---------- */

  const HOURLY = [
    'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'dew_point_2m', 'precipitation_probability', 'precipitation', 'snowfall',
    'weather_code', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high', 'visibility', 'wind_speed_10m', 'wind_gusts_10m',
    'wind_direction_10m', 'uv_index', 'shortwave_radiation', 'surface_pressure',
  ];
  const UNITS = '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=GMT';

  const msOf = (t) => Date.parse(t.length === 16 ? t + ':00Z' : t.endsWith('Z') ? t : t + 'Z');
  const num = (a, i) => (a && isNum(a[i]) ? a[i] : null);

  function normalizeWeather(j) {
    const h = j && j.hourly;
    if (!h || !Array.isArray(h.time) || !h.time.length) throw new ProviderError('shape', 'Forecast response has no hourly data');
    const hours = h.time.map((t, i) => ({
      ms: msOf(t), tempF: num(h.temperature_2m, i), feelsF: num(h.apparent_temperature, i), rh: num(h.relative_humidity_2m, i), dewF: num(h.dew_point_2m, i),
      pop: num(h.precipitation_probability, i), precipIn: num(h.precipitation, i) == null ? 0 : h.precipitation[i], snowIn: num(h.snowfall, i) == null ? 0 : h.snowfall[i],
      code: num(h.weather_code, i), cloud: num(h.cloud_cover, i), cloudLow: num(h.cloud_cover_low, i), cloudMid: num(h.cloud_cover_mid, i), cloudHigh: num(h.cloud_cover_high, i),
      visMi: num(h.visibility, i) == null ? null : Math.min(24, h.visibility[i] / 5280), windMph: num(h.wind_speed_10m, i), gustMph: num(h.wind_gusts_10m, i), windDir: num(h.wind_direction_10m, i),
      uv: num(h.uv_index, i), rad: num(h.shortwave_radiation, i), pressHpa: num(h.surface_pressure, i), aqi: null, pm25: null,
    })).filter((x) => isNum(x.tempF) && isNum(x.feelsF));
    if (!hours.length) throw new ProviderError('shape', 'Forecast response has no usable hours');
    const m = j.minutely_15;
    const minutely = m && Array.isArray(m.time) ? m.time.map((t, i) => ({ ms: msOf(t), precipIn: num(m.precipitation, i) || 0 })) : [];
    const cur = j.current || null;
    const current = cur ? { ms: msOf(cur.time), tempF: cur.temperature_2m, feelsF: cur.apparent_temperature, code: cur.weather_code, isDay: cur.is_day === 1, precipIn: cur.precipitation } : null;
    return { hours, minutely, current };
  }

  function normalizeAir(j) {
    const h = j && j.hourly;
    if (!h || !Array.isArray(h.time)) throw new ProviderError('shape', 'Air-quality response has no hourly data');
    return h.time.map((t, i) => ({ ms: msOf(t), aqi: num(h.us_aqi, i), pm25: num(h.pm2_5, i) }));
  }

  const ckey = (p) => p.lat.toFixed(3) + ',' + p.lon.toFixed(3);

  // One call: yesterday plus eight days of hours, the next 6 hours at 15 minutes, and the current reading.
  async function fetchWeather(place) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + place.lat + '&longitude=' + place.lon + '&hourly=' + HOURLY.join(',') +
      '&minutely_15=precipitation&current=temperature_2m,apparent_temperature,weather_code,is_day,precipitation&past_days=1&forecast_days=8&past_minutely_15=4&forecast_minutely_15=24' + UNITS;
    const res = await cachedJson('wx:' + ckey(place), 10 * 60000, url);
    return Object.assign(normalizeWeather(res.json), { at: res.at, fromCache: res.fromCache, stale: !!res.stale, error: res.error || null });
  }

  async function fetchAir(place) {
    const url = 'https://air-quality-api.open-meteo.com/v1/air-quality?latitude=' + place.lat + '&longitude=' + place.lon + '&hourly=us_aqi,pm2_5&past_days=1&forecast_days=6&timezone=GMT';
    const res = await cachedJson('aq:' + ckey(place), 60 * 60000, url);
    return { records: normalizeAir(res.json), at: res.at };
  }

  // Active National Weather Service alerts for a point (US only). Empty list when none.
  async function fetchAlerts(place) {
    const res = await cachedJson('al:' + ckey(place), 10 * 60000, 'https://api.weather.gov/alerts/active?point=' + place.lat.toFixed(4) + ',' + place.lon.toFixed(4), { retries: 1, timeoutMs: 10000 });
    return normalizeAlerts(res.json);
  }
  const SEV = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };
  function normalizeAlerts(j) {
    const f = (j && j.features) || [];
    return f.map((x) => x.properties || {}).filter((p) => p.event).map((p) => ({
      event: p.event, severity: p.severity || 'Unknown', rank: SEV[p.severity] || 0, headline: p.headline || p.event, area: p.areaDesc || '',
      endsMs: Date.parse(p.ends || p.expires || '') || null, instruction: p.instruction || '',
    })).sort((a, b) => b.rank - a.rank);
  }

  // Current conditions for several saved places in one request (the family strip).
  async function fetchNowMany(places) {
    if (!places.length) return [];
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + places.map((p) => p.lat).join(',') + '&longitude=' + places.map((p) => p.lon).join(',') +
      '&current=temperature_2m,apparent_temperature,weather_code,is_day,cloud_cover,precipitation&temperature_unit=fahrenheit&timezone=auto';
    const key = 'many:' + places.map(ckey).join('|');
    const res = await cachedJson(key, 5 * 60000, url);
    const arr = Array.isArray(res.json) ? res.json : [res.json];
    return arr.map((j) => {
      const c = (j && j.current) || {};
      return { tempF: c.temperature_2m, feelsF: c.apparent_temperature, code: c.weather_code, isDay: c.is_day === 1, cloud: c.cloud_cover, precipIn: c.precipitation, ms: c.time ? Date.parse(c.time + ':00Z') - (j.utc_offset_seconds || 0) * 1000 : null };
    });
  }

  return {
    ProviderError, cache, http, cachedJson, zipOk, parseLatLon, geocodeZip, reverseName, resolveTimezone, searchPlaces, resolvePlaces,
    normalizeWeather, normalizeAir, normalizeAlerts, fetchWeather, fetchAir, fetchAlerts, fetchNowMany, HOURLY, stateAbbr,
  };
});
