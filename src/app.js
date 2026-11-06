/* MyWeather UI. DOM is built with textContent and createElement only (never innerHTML).
 * One idea: time is a thing you drag. The sky, the feel, the plan and the timeline all follow one number, S.T.
 */
(function () {
  'use strict';
  const C = MyWeatherCore, P = MyWeatherProviders, K = MyWeatherSky;
  const HOUR = C.HOUR, DAY = C.DAY;
  const $ = (s, el) => (el || document).querySelector(s);
  const isNum = C.isNum;
  const clamp = C.clamp;

  /* ---------- tiny DOM helpers ---------- */

  function h(tag, attrs) {
    const el = document.createElement(tag);
    for (const k in attrs || {}) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) kid.forEach((k) => add(el, k));
    else el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
    for (let i = 2; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]);
    return el;
  }
  const path = (d, extra) => svg('path', Object.assign({ d }, extra || {}));
  function icon(name, size) {
    const s = size || 20;
    const a = { viewBox: '0 0 24 24', width: s, height: s, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
    const body = {
      play: [path('M7 4.5v15l12-7.5z', { fill: 'currentColor', stroke: 'none' })],
      pause: [path('M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z', { fill: 'currentColor', stroke: 'none' })],
      now: [svg('circle', { cx: 12, cy: 12, r: 3 }), path('M12 2v4M12 18v4M2 12h4M18 12h4')],
      chevron: [path('M6 9l6 6 6-6')],
      plus: [path('M12 5v14M5 12h14')],
      close: [path('M6 6l12 12M18 6L6 18')],
      pin: [path('M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z'), svg('circle', { cx: 12, cy: 9.5, r: 2.5 })],
      locate: [svg('circle', { cx: 12, cy: 12, r: 7 }), svg('circle', { cx: 12, cy: 12, r: 2, fill: 'currentColor' }), path('M12 1v3M12 20v3M1 12h3M20 12h3')],
      alert: [path('M12 3.5l9.5 16.5h-19z'), path('M12 10v4.5M12 17.2v.1')],
      search: [svg('circle', { cx: 11, cy: 11, r: 6.5 }), path('M20 20l-4.2-4.2')],
      arrow: [path('M12 20V5M6 11l6-6 6 6')],
    }[name] || [];
    return svg('svg', a, ...body);
  }
  // Weather glyphs for the week list and the family orbs (drawn, no emoji).
  function wxIcon(kind, size, night) {
    const s = size || 28;
    const a = { viewBox: '0 0 32 32', width: s, height: s, fill: 'none', 'aria-hidden': 'true' };
    const cloud = (fill) => path('M9 24a5.5 5.5 0 0 1-.4-11 7.5 7.5 0 0 1 14.3 1.6A4.7 4.7 0 0 1 23 24z', { fill: fill || '#e9eef5' });
    const sun = (cx, cy, r) => [svg('circle', { cx, cy, r, fill: '#ffd36a' }), ...Array.from({ length: 8 }, (_, i) => { const t = (i * Math.PI) / 4; return svg('line', { x1: cx + Math.cos(t) * (r + 2.5), y1: cy + Math.sin(t) * (r + 2.5), x2: cx + Math.cos(t) * (r + 5), y2: cy + Math.sin(t) * (r + 5), stroke: '#ffd36a', 'stroke-width': 2, 'stroke-linecap': 'round' }); })];
    const moon = (cx, cy) => path('M' + (cx + 5) + ' ' + (cy + 8) + 'a9 9 0 1 1 -5 -15a7 7 0 0 0 5 15z', { fill: '#f2efe2' });
    const rain = (n) => Array.from({ length: n }, (_, i) => svg('line', { x1: 11 + i * 5, y1: 26, x2: 9.5 + i * 5, y2: 30, stroke: '#8ec5ff', 'stroke-width': 2, 'stroke-linecap': 'round' }));
    const parts = {
      clear: night ? [moon(16, 16)] : sun(16, 16, 6),
      partly: night ? [moon(12, 12), cloud()] : [...sun(12, 12, 5), cloud()],
      cloudy: [cloud('#cdd6e1')],
      fog: [path('M5 11h22M3 17h26M7 23h18', { stroke: '#cfd8e3', 'stroke-width': 2.4, 'stroke-linecap': 'round' })],
      rain: [cloud('#c7d1de'), ...rain(4)],
      snow: [cloud('#dfe7f1'), ...[11, 16, 21].map((x) => svg('circle', { cx: x, cy: 28, r: 1.6, fill: '#fff' }))],
      thunder: [cloud('#a9b4c4'), path('M17 20l-4 6h3.5l-1.5 5 6-7.5h-3.8l2-3.5z', { fill: '#ffd36a' })],
    }[kind] || [cloud()];
    return svg('svg', a, ...parts.flat());
  }

  /* ---------- storage ---------- */

  const store = {
    get(k, d) { try { const v = localStorage.getItem('mw:app:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('mw:app:' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  /* ---------- state ---------- */

  const S = {
    place: null, places: store.get('places', []), wx: null, hours: null, minutely: [], current: null, aqAt: null,
    alerts: [], family: [], nowMs: Date.now(), T: Date.now(), follow: true, actId: store.get('act', null), scores: null, windows: [],
    loading: false, error: null, stale: null, domain: null, elevs: null, playing: false, loadId: 0, dayInfo: null, todayScroll: 0, todayBuiltAt: 0, hinted: store.get('hinted', false),
  };
  const fmtDeg = (v) => (isNum(v) ? Math.round(v) + '°' : '–');

  let sky = null;
  let ribbon = null, rctx = null, rW = 0, rH = 0, rdpr = 1;

  /* ---------- places ---------- */

  const placeId = (p) => p.lat.toFixed(2) + ',' + p.lon.toFixed(2);
  const placeTitle = (p) => p.name + (p.state ? ', ' + p.state : '');
  function savePlace(p) {
    const q = { name: p.name, state: p.state || '', lat: +p.lat, lon: +p.lon, tz: p.tz, elevM: p.elevM || 0 };
    q.id = placeId(q);
    const i = S.places.findIndex((x) => x.id === q.id);
    if (i >= 0) S.places[i] = Object.assign(S.places[i], q); else S.places.push(q);
    if (S.places.length > 8) S.places = S.places.slice(-8);
    store.set('places', S.places);
    return S.places.find((x) => x.id === q.id);
  }
  function removePlace(id) {
    S.places = S.places.filter((p) => p.id !== id);
    store.set('places', S.places);
    if (S.place && S.place.id === id) { if (S.places.length) choosePlace(S.places[0]); }
    renderFamily();
    renderSheet();
  }

  async function choosePlace(p) {
    const q = S.places.find((x) => x.id === placeId(p)) || savePlace(p);
    store.set('cur', q.id);
    closeSheet();
    $('#firstrun').hidden = true;
    await load(q);
  }

  /* ---------- loading ---------- */

  async function load(place) {
    const id = ++S.loadId;
    S.loading = true; S.error = null;
    if (!S.hours || (S.place && S.place.id !== place.id)) { $('#loading').hidden = false; $('#hero').classList.add('is-loading'); }
    renderTop(place);
    try {
      const [wx, aq] = await Promise.all([P.fetchWeather(place), P.fetchAir(place).catch(() => null)]);
      if (id !== S.loadId) return;
      S.place = place;
      S.wx = wx;
      S.hours = C.mergeAir(wx.hours, aq ? aq.records : []);
      S.minutely = wx.minutely; S.current = wx.current;
      S.stale = wx.stale ? wx.at : null;
      S.nowMs = Date.now();
      const sameHome = S.domain && S.domain.place === place.id;
      setupDomain();
      if (!sameHome || S.follow) { S.T = clamp(S.nowMs, S.domain.d0, S.domain.d1 - HOUR); S.follow = true; }
      S.loading = false;
      $('#loading').hidden = true; $('#hero').classList.remove('is-loading');
      afterData();
      refreshExtras(place, id);
    } catch (e) {
      if (id !== S.loadId) return;
      S.loading = false; S.error = { message: e.message || 'Could not load the forecast.', place };
      $('#loading').hidden = true; $('#hero').classList.remove('is-loading');
      renderBanner();
    }
  }

  function refreshExtras(place, id) {
    P.fetchAlerts(place).then((a) => { if (id === S.loadId) { S.alerts = a; renderAlerts(); } }).catch(() => { if (id === S.loadId) { S.alerts = []; renderAlerts(); } });
    refreshFamily();
  }
  function refreshFamily() {
    if (!S.places.length) return;
    const list = S.places.slice();
    P.fetchNowMany(list).then((rows) => { S.family = list.map((p, i) => Object.assign({ place: p }, rows[i] || {})); renderFamily(); }).catch(() => {});
  }

  function setupDomain() {
    const tz = S.place.tz;
    const k0 = C.localParts(S.nowMs, tz).date;
    let k = k0;
    for (let i = 0; i < 7; i++) k = C.nextDayKey(k);
    const d0 = C.zonedMidnight(k0, tz), d1 = Math.min(C.zonedMidnight(k, tz), S.hours[S.hours.length - 1].ms + HOUR);
    S.domain = { d0: Math.max(d0, S.hours[0].ms), d1, place: S.place.id };
    S.elevs = S.hours.map((x) => C.sunPosition(S.place.lat, S.place.lon, x.ms).elevDeg);
    S.days = C.groupDays(S.hours, tz).filter((d) => d.startMs >= S.domain.d0 - 1 && d.startMs < S.domain.d1);
    S.scores = null; S.windows = [];
    S.dayInfo = null;
  }

  function afterData() {
    renderTop(S.place);
    renderBanner();
    renderAlerts();
    renderActivities();
    renderToday();
    renderWeek();
    renderFamily();
    sizeRibbon();
    requestUpdate();
    document.title = Math.round(C.sampleAt(S.hours, S.nowMs).feelsF) + '° ' + placeTitle(S.place) + ' · MyWeather';
    if (!S.hinted) $('#hint').hidden = false;
  }

  /* ---------- the one update: everything follows S.T ---------- */

  let pending = false;
  function requestUpdate() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; update(); }); }

  // Open-Meteo's "current" reading is more exact than the hourly blend; nudge the near-term hours toward it.
  function calibrated(r, T) {
    const c = S.current;
    if (!c || !isNum(c.tempF) || !isNum(c.feelsF) || !c.ms) return r;
    const base = C.sampleAt(S.hours, c.ms);
    const dist = Math.abs(T - c.ms) / HOUR;
    const w = clamp(1 - dist / 3, 0, 1);
    if (!w || !base) return r;
    return Object.assign({}, r, { tempF: r.tempF + (c.tempF - base.tempF) * w, feelsF: r.feelsF + (c.feelsF - base.feelsF) * w });
  }

  function snowCoverAt(T) {
    let s = 0;
    for (const x of S.hours) if (x.ms <= T && x.ms > T - 36 * HOUR) s += x.snowIn || 0;
    const r = C.sampleAt(S.hours, T);
    return s >= 0.4 && r.tempF <= 38;
  }

  function update() {
    if (!S.hours || !S.domain) return;
    const T = S.T, tz = S.place.tz;
    const r0 = C.sampleAt(S.hours, T);
    const r = calibrated(r0, T);
    const c = C.contextAt(S.place, S.hours, T);
    const info = C.codeInfo(r.code);
    const story = C.feelsStory(r);
    const isNow = Math.abs(T - S.nowMs) < 20 * 60000;

    $('#when').textContent = C.whenLabel(T, S.nowMs, tz);
    $('#date').textContent = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(T)) + (isNow ? ' · ' + new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(S.nowMs)) : '');
    $('#feelNum').textContent = isNum(r.feelsF) ? Math.round(r.feelsF) : '–';
    $('#air').textContent = 'Air ' + fmtDeg(r.tempF) + ' · ' + info.label.toLowerCase();
    $('#headline').textContent = story.headline;
    $('#vibe').textContent = C.vibe(r, c);
    const dr = $('#drivers'); clear(dr);
    story.drivers.forEach((d) => dr.appendChild(h('span', { class: 'drv ' + d.kind }, d.text)));

    // The line under the headline: a rain countdown when it matters, else what the next hours hold.
    let next = '';
    const nc = isNow ? C.nowcast(S.minutely, S.nowMs, { snow: r.tempF <= 33 }) : null;
    if (nc && nc.state !== 'dry') next = nc.text;
    else next = C.outlook(S.hours, S.place, T, 12);
    const yd = C.vsYesterday(S.hours, T);
    $('#next').textContent = next;
    $('#yday').textContent = yd ? ' ' + yd : '';

    renderDress(r, c);
    renderAskResult(r, c);
    drawRibbon();
    renderDetails(r, c, info, story);
    renderSun(T, r);
    syncToday();

    sky.set(K.stateFrom(r, c, info, { snowCover: snowCoverAt(T) }));
    const sl = $('#ribbon');
    sl.setAttribute('aria-valuetext', C.whenLabel(T, S.nowMs, tz) + ', feels ' + Math.round(r.feelsF) + ' degrees');
    sl.setAttribute('aria-valuenow', Math.round((T - S.domain.d0) / HOUR));
    $('#nowBtn').classList.toggle('on', isNow);
    document.body.classList.toggle('feel-cold', r.feelsF <= 34);
    document.body.classList.toggle('feel-hot', r.feelsF >= 90);
    document.body.classList.toggle('is-day', c.elev > 0);
  }

  /* ---------- top bar, banners, alerts ---------- */

  function renderTop(place) {
    $('#placeName').textContent = place ? placeTitle(place) : 'Choose a place';
  }

  function renderBanner() {
    const b = clear($('#banner'));
    if (S.error) {
      b.appendChild(h('div', { class: 'banner warn', role: 'alert' }, S.error.message + ' ', h('button', { type: 'button', class: 'linkbtn', onclick: () => (S.error.place ? load(S.error.place) : openSheet()) }, 'Try again')));
    } else if (S.stale) {
      const mins = Math.max(1, Math.round((Date.now() - S.stale) / 60000));
      b.appendChild(h('div', { class: 'banner info' }, 'You are offline or the forecast is slow. Showing the last forecast, ' + (mins < 90 ? mins + ' min' : Math.round(mins / 60) + ' h') + ' old.'));
    }
  }

  function renderAlerts() {
    const pill = $('#alertPill'), card = clear($('#alertCard'));
    if (!S.alerts.length) { pill.hidden = true; card.hidden = true; return; }
    const top = S.alerts[0];
    pill.hidden = false;
    pill.className = 'alertpill sev' + top.rank;
    clear(pill).append(icon('alert', 16), h('span', null, S.alerts.length === 1 ? top.event : S.alerts.length + ' alerts'));
    for (const a of S.alerts.slice(0, 4)) {
      card.appendChild(h('div', { class: 'alert sev' + a.rank }, h('strong', null, a.event), h('p', null, a.headline), a.endsMs ? h('p', { class: 'muted' }, 'Until ' + C.whenLabel(a.endsMs, S.nowMs, S.place.tz)) : null, a.instruction ? h('p', { class: 'muted small' }, a.instruction.slice(0, 220)) : null));
    }
  }

  /* ---------- dress ---------- */

  function renderDress(r, c) {
    const items = C.dress(r, c);
    const key = items.map((x) => x.label).join('|');
    const el = $('#dress');
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    clear(el);
    for (const it of items) el.appendChild(h('span', { class: 'pill ' + it.id, title: it.why }, it.label));
  }

  /* ---------- ask the sky ---------- */

  function renderActivities() {
    const row = clear($('#ask'));
    for (const a of C.ACTIVITIES) {
      row.appendChild(h('button', { type: 'button', class: 'chip' + (S.actId === a.id ? ' on' : ''), 'aria-pressed': S.actId === a.id ? 'true' : 'false', onclick: () => pickActivity(S.actId === a.id ? null : a.id) }, a.label));
    }
  }
  function pickActivity(id) {
    S.actId = id; store.set('act', id);
    S.scores = null; S.windows = [];
    renderActivities();
    requestUpdate();
  }
  function ensureScores() {
    if (!S.actId) { S.scores = null; S.windows = []; return; }
    if (S.scores && S.scores.id === S.actId) return;
    S.scores = { id: S.actId, v: C.scoreSeries(S.place, S.hours, S.actId) };
    S.windows = C.bestWindows(S.place, S.hours, S.actId, S.nowMs, 4);
  }
  function renderAskResult(r, c) {
    const box = $('#askResult');
    if (!S.actId) { box.hidden = true; return; }
    ensureScores();
    box.hidden = false;
    const act = C.ACTIVITIES.find((a) => a.id === S.actId);
    const rt = C.rate(S.actId, r, c);
    const tz = S.place.tz;
    clear(box);
    box.appendChild(h('div', { class: 'askNow' }, h('span', { class: 'score s-' + rt.label.toLowerCase() }, rt.score), h('span', null, h('strong', null, act.label + ': ' + rt.label), ' · ' + (rt.why || ''))));
    const wins = h('div', { class: 'wins' });
    if (!S.windows.length) wins.appendChild(h('span', { class: 'muted small' }, 'No good window in the next week.'));
    for (const w of S.windows) {
      const lbl = C.dayLabel(w.startMs, S.nowMs, tz) + ' ' + C.hourLabel(w.startMs, tz).replace(' ', '').toLowerCase() + '–' + C.hourLabel(w.endMs, tz).replace(' ', '').toLowerCase();
      wins.appendChild(h('button', { type: 'button', class: 'win', onclick: () => goTo(w.peakMs) }, h('b', null, w.peak), ' ' + lbl));
    }
    box.appendChild(wins);
  }

  /* ---------- details ---------- */

  function tile(label, value, sub, extra) {
    return h('div', { class: 'tile' }, h('div', { class: 'tl' }, label), h('div', { class: 'tv' }, value, extra || null), sub ? h('div', { class: 'ts' }, sub) : null);
  }
  function renderDetails(r, c, info, story) {
    const el = $('#details');
    const tz = S.place.tz;
    const arrow = h('span', { class: 'windarrow', style: { transform: 'rotate(' + (isNum(r.windDir) ? r.windDir + 180 : 0) + 'deg)' } }, icon('arrow', 16));
    const pt = C.pressureTrend(S.hours, S.T);
    const grid = h('div', { class: 'tiles' },
      tile('Wind', Math.round(r.windMph || 0) + ' mph ', 'from the ' + (C.dirName(r.windDir) || '–') + ', gusts ' + Math.round(r.gustMph || 0), arrow),
      tile('Humidity', C.comfortWord(r.dewF) || '–', 'Dew point ' + fmtDeg(r.dewF) + ' · ' + Math.round(r.rh || 0) + '%'),
      tile('Rain', isNum(r.pop) ? Math.round(r.pop) + '%' : '–', (r.precipIn || 0) >= 0.005 ? (r.precipIn).toFixed(2) + ' in this hour' : 'Nothing measurable'),
      tile('UV', Math.round(r.uv || 0), c.elev > 0 ? C.uvWord(r.uv) : 'Sun is down'),
      tile('Air quality', isNum(r.aqi) ? Math.round(r.aqi) : '–', isNum(r.aqi) ? C.aqiWord(r.aqi) : 'Not available'),
      tile('Visibility', (r.visMi >= 10 ? '10+' : (r.visMi || 0).toFixed(1)) + ' mi', r.visMi < 3 ? 'Hazy or foggy' : 'Clear'),
      tile('Cloud cover', Math.round(r.cloud || 0) + '%', 'Low ' + Math.round(r.cloudLow || 0) + ' · high ' + Math.round(r.cloudHigh || 0)),
      tile('Pressure', pt ? pt.inHg.toFixed(2) : '–', pt ? pt.word + ' (inHg)' : ''),
    );
    const why = h('div', { class: 'why' }, h('div', { class: 'whyrow' }, h('span', { class: 'big' }, fmtDeg(r.tempF)), h('span', { class: 'arr' }, '→'), h('span', { class: 'big' }, fmtDeg(r.feelsF))), h('div', { class: 'whylbl' }, 'air  →  feels like'), story.drivers.length ? h('div', { class: 'drivers' }, story.drivers.map((d) => h('span', { class: 'drv ' + d.kind }, d.text))) : h('p', { class: 'muted small' }, Math.abs(story.delta) < 2 ? 'The air and the feel are about the same right now.' : ''));
    clear(el).append(h('h3', null, 'At ' + C.whenLabel(S.T, S.nowMs, tz).toLowerCase().replace(/^now$/, 'this moment')), why, grid);
  }

  function renderSun(T, r) {
    const el = $('#sun'), tz = S.place.tz, p = S.place;
    const key = C.localParts(T, tz).date;
    const st = C.sunTimes(p.lat, p.lon, key, tz);
    const moon = C.moonState(p.lat, p.lon, T);
    const ssAt = st.sunset ? C.sampleAt(S.hours, st.sunset - 20 * 60000) : null;
    const q = ssAt ? C.sunsetQuality(ssAt) : null;
    const len = st.sunrise && st.sunset ? st.sunset - st.sunrise : null;
    clear(el);
    el.appendChild(h('h3', null, C.dayLabel(T, S.nowMs, tz, true) + "'s sky"));
    const row = h('div', { class: 'sunrow' },
      h('div', null, h('div', { class: 'tl' }, 'Sunrise'), h('div', { class: 'tv' }, st.sunrise ? C.hourLabel(st.sunrise, tz) : '–')),
      h('div', null, h('div', { class: 'tl' }, 'Sunset'), h('div', { class: 'tv' }, st.sunset ? C.hourLabel(st.sunset, tz) : '–')),
      h('div', null, h('div', { class: 'tl' }, 'Daylight'), h('div', { class: 'tv' }, len ? Math.floor(len / HOUR) + 'h ' + Math.round((len % HOUR) / 60000) + 'm' : '–')));
    el.appendChild(row);
    if (q) {
      el.appendChild(h('div', { class: 'sunset' }, h('div', { class: 'sunsetbar' }, h('i', { style: { width: q.score + '%' } })), h('div', null, h('strong', null, 'Sunset: ' + q.label), ' ' + q.why)));
    }
    el.appendChild(h('div', { class: 'moonrow' }, moonSvg(moon, 34), h('div', null, h('strong', null, C.moonName(moon.phase)), h('div', { class: 'muted small' }, Math.round(moon.illum * 100) + '% lit' + (moon.elevDeg > 0 ? ', in the sky now' : ', below the horizon')))));
    el.appendChild(h('a', { class: 'ext', href: 'https://ebhanu-1.github.io/clearsky/#' + p.lat.toFixed(3) + ', ' + p.lon.toFixed(3), rel: 'noopener' }, 'Planning a photo shoot? Open this spot in ClearSky'));
  }
  function moonSvg(m, size) {
    const r = 15, ill = clamp(m.illum, 0, 1), rx = Math.max(0.01, r * Math.abs(1 - 2 * ill)), right = m.waxing, cres = ill < 0.5;
    const d = 'M0 ' + -r + ' A' + r + ' ' + r + ' 0 0 ' + (right ? 1 : 0) + ' 0 ' + r + ' A' + rx + ' ' + r + ' 0 0 ' + (cres === right ? 0 : 1) + ' 0 ' + -r + 'Z';
    return svg('svg', { viewBox: '-17 -17 34 34', width: size, height: size, 'aria-hidden': 'true' }, svg('circle', { r, fill: '#2a3550' }), path(d, { fill: '#f2efe2' }));
  }

  /* ---------- today, hour by hour ---------- */

  // The strip is built once per forecast load; scrubbing only moves the highlight (syncToday), so dragging stays cheap.
  let todayCols = [], todaySel = -1, todayKey = null;
  function renderToday() {
    const el = $('#today');
    clear(el);
    todayCols = []; todaySel = -1; S.todayBuiltAt = S.nowMs;
    const t = C.todayHours(S.place, S.hours, S.nowMs);
    if (!t.rows.length) { todayKey = null; return; }
    const keep = todayKey === t.key && el.dataset.place === S.place.id ? S.todayScroll : null;
    todayKey = t.key; el.dataset.place = S.place.id;
    el.appendChild(h('h3', null, 'Today, hour by hour'));
    if (t.summary) el.appendChild(h('p', { class: 'tsum' }, t.summary));
    const strip = h('div', { class: 'hours', role: 'group', 'aria-label': 'Hours of today. Tap one to see the sky then' });
    for (const row0 of t.rows) {
      const row = calibrated(row0, row0.ms);
      const info = C.codeInfo(row0.code);
      const wet = row0.pop >= 20 || row0.precipIn >= 0.01;
      const col = h('button', { type: 'button', class: 'hcol' + (row0.past ? ' past' : '') + (row0.now ? ' now' : '') + (row0.night ? ' night' : ''), 'data-ms': row0.ms, onclick: () => { goTo(row0.now ? S.nowMs : row0.ms, true); document.getElementById('hero').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
        'aria-label': (row0.now ? 'Now' : row0.label) + ', feels ' + (isNum(row.feelsF) ? Math.round(row.feelsF) + ' degrees' : 'unknown') + ', ' + info.label.toLowerCase() + (wet ? ', ' + Math.round(row0.pop) + '% chance of rain' : '') },
        h('span', { class: 'ht' }, row0.now ? 'Now' : row0.label.replace(' ', ' ')),
        h('span', { class: 'hi' }, wxIcon(info.kind, 26, row0.night)),
        h('b', { class: 'hf' }, fmtDeg(row.feelsF)),
        h('span', { class: 'hp' }, wet ? Math.round(row0.pop) + '%' : ''),
        h('span', { class: 'hs' }, row0.sun === 'sunrise' ? 'Sunrise' : row0.sun === 'sunset' ? 'Sunset' : ''));
      todayCols.push({ ms: row0.ms, el: col });
      strip.appendChild(col);
    }
    el.appendChild(strip);
    strip.addEventListener('scroll', () => { S.todayScroll = strip.scrollLeft; }, { passive: true });
    // First view: line up with the current hour (the past is one swipe to the left). Later reloads keep where you were.
    const nowCol = todayCols.find((c) => c.el.classList.contains('now')) || todayCols[0];
    strip.scrollLeft = keep != null ? keep : Math.max(0, nowCol.el.offsetLeft - 8);
    S.todayScroll = strip.scrollLeft;
    syncToday(true);
  }
  // Highlight the hour being looked at; when it changes, bring it into view (only if the strip is showing today).
  function syncToday(force) {
    if (!todayCols.length) return;
    const T = S.T;
    let sel = -1;
    const isNow = Math.abs(T - S.nowMs) < 20 * 60000;
    for (let i = 0; i < todayCols.length; i++) {
      const c = todayCols[i];
      if (isNow ? c.el.classList.contains('now') : T >= c.ms - HOUR / 2 && T < c.ms + HOUR / 2) { sel = i; break; }
    }
    if (sel === todaySel && !force) return;
    if (todaySel >= 0 && todayCols[todaySel]) todayCols[todaySel].el.classList.remove('sel');
    todaySel = sel;
    if (sel < 0) return;
    const col = todayCols[sel].el, strip = col.parentNode;
    col.classList.add('sel');
    const left = strip.scrollLeft, w = strip.clientWidth;
    if (col.offsetLeft < left + 4 || col.offsetLeft + col.offsetWidth > left + w - 4) {
      strip.scrollTo({ left: Math.max(0, col.offsetLeft - (w - col.offsetWidth) / 2), behavior: S.playing ? 'auto' : 'smooth' });
    }
  }

  /* ---------- the week ---------- */

  function renderWeek() {
    const el = $('#week'), tz = S.place.tz;
    clear(el);
    el.appendChild(h('h3', null, 'The week'));
    const days = S.days;
    const lo = Math.min(...days.map((d) => d.lo)), hi = Math.max(...days.map((d) => d.hi));
    for (const d of days) {
      const info = C.codeInfo(d.code);
      const l = ((d.lo - lo) / (hi - lo || 1)) * 100, w = Math.max(6, ((d.hi - d.lo) / (hi - lo || 1)) * 100);
      el.appendChild(h('button', { type: 'button', class: 'dayrow', onclick: () => goToDay(d) },
        h('span', { class: 'dn' }, C.dayLabel(d.startMs + 6 * HOUR, S.nowMs, tz)),
        h('span', { class: 'di' }, wxIcon(info.kind, 26)),
        h('span', { class: 'dp' }, d.pop >= 20 ? Math.round(d.pop) + '%' : ''),
        h('span', { class: 'dl' }, fmtDeg(d.lo)),
        h('span', { class: 'dbar' }, h('i', { style: { left: l + '%', width: w + '%' } })),
        h('span', { class: 'dh' }, fmtDeg(d.hi))));
    }
  }
  function goToDay(d) {
    const tz = S.place.tz;
    const lp = C.localParts(S.T, tz);
    const isToday = C.localParts(S.nowMs, tz).date === d.key;
    const target = isToday ? S.nowMs : d.startMs + (lp.hour + 0.5) * HOUR;
    goTo(target);
    document.getElementById('hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- family ---------- */

  function renderFamily() {
    const el = $('#family');
    clear(el);
    el.appendChild(h('h3', null, 'Everyone'));
    const row = h('div', { class: 'orbs' });
    for (const p of S.places) {
      const f = S.family.find((x) => x.place && x.place.id === p.id) || {};
      const info = C.codeInfo(f.code);
      const ms = Date.now();
      const elev = C.sunPosition(p.lat, p.lon, ms).elevDeg;
      const pal = K.skyPalette(elev, { overcast: clamp((f.cloud || 0) / 100, 0, 1) * 0.9, rain: info.wet ? 0.4 : 0, fog: info.kind === 'fog' ? 0.8 : 0 });
      const bg = 'linear-gradient(180deg, rgb(' + pal.z.map(Math.round) + ') 0%, rgb(' + pal.u.map(Math.round) + ') 55%, rgb(' + pal.h.map(Math.round) + ') 100%)';
      const here = S.place && S.place.id === p.id;
      row.appendChild(h('button', { type: 'button', class: 'orb' + (here ? ' here' : ''), onclick: () => choosePlace(p), 'aria-label': placeTitle(p) + (isNum(f.feelsF) ? ', feels ' + Math.round(f.feelsF) + ' degrees, ' + info.label : '') },
        h('span', { class: 'disc', style: { background: bg } }, wxIcon(info.kind, 26, elev < -2), h('b', null, isNum(f.feelsF) ? Math.round(f.feelsF) + '°' : '–')),
        h('span', { class: 'on' }, p.name), h('span', { class: 'oc' }, isNum(f.feelsF) ? info.label : '')));
    }
    row.appendChild(h('button', { type: 'button', class: 'orb addorb', onclick: () => openSheet(), 'aria-label': 'Add a place' }, h('span', { class: 'disc add' }, icon('plus', 22)), h('span', { class: 'on' }, 'Add place')));
    el.appendChild(row);
  }

  /* ---------- timeline ribbon ---------- */

  function sizeRibbon() {
    rdpr = Math.min(window.devicePixelRatio || 1, 2);
    rW = ribbon.clientWidth; rH = ribbon.clientHeight;
    ribbon.width = Math.round(rW * rdpr); ribbon.height = Math.round(rH * rdpr);
    rctx.setTransform(rdpr, 0, 0, rdpr, 0, 0);
  }
  const rx = (ms) => ((ms - S.domain.d0) / (S.domain.d1 - S.domain.d0)) * rW;

  function drawRibbon() {
    if (!S.hours || !S.domain || !rW) return;
    ensureScores();
    const ctx = rctx, tz = S.place.tz, d0 = S.domain.d0, d1 = S.domain.d1;
    const labelH = 18, top = 14, plotH = rH - labelH - top - 4;
    ctx.clearRect(0, 0, rW, rH);
    const idx = S.hours.map((x, i) => i).filter((i) => S.hours[i].ms >= d0 - HOUR && S.hours[i].ms <= d1);
    // night and twilight bands, and the activity glow behind everything
    for (const i of idx) {
      const x0 = rx(S.hours[i].ms - HOUR / 2), x1 = rx(S.hours[i].ms + HOUR / 2);
      const el = S.elevs[i];
      const night = clamp((4 - el) / 10, 0, 1);
      if (night > 0) { ctx.fillStyle = 'rgba(8,14,40,' + (night * 0.42).toFixed(3) + ')'; ctx.fillRect(x0, 0, x1 - x0 + 0.6, rH - labelH); }
      if (S.scores) {
        const sc = S.scores.v[i];
        if (sc >= 50) {
          const a = clamp((sc - 50) / 50, 0, 1);
          const g = ctx.createLinearGradient(0, top, 0, rH - labelH);
          g.addColorStop(0, 'rgba(140,240,170,' + (0.08 + a * 0.12).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(140,240,170,' + (0.2 + a * 0.5).toFixed(3) + ')');
          ctx.fillStyle = g; ctx.fillRect(x0, top, x1 - x0 + 0.6, rH - labelH - top);
        }
      }
    }
    // rain
    for (const i of idx) {
      const hr = S.hours[i];
      const v = Math.max(((hr.pop || 0) / 100) * 0.55, clamp((hr.precipIn || 0) * 8, 0, 1));
      if (v < 0.04) continue;
      const x0 = rx(hr.ms - HOUR / 2), x1 = rx(hr.ms + HOUR / 2), bh = v * plotH;
      ctx.fillStyle = 'rgba(120,190,255,' + (0.3 + clamp((hr.precipIn || 0) * 6, 0, 0.5)).toFixed(3) + ')';
      ctx.fillRect(x0, top + plotH - bh, x1 - x0 + 0.6, bh);
    }
    // day separators and labels
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'alphabetic';
    for (const d of S.days) {
      const x = rx(d.startMs);
      if (x > 1) { ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.fillRect(Math.round(x), top, 1, rH - labelH - top); }
      const xe = rx(Math.min(d1, d.startMs + DAY));
      const mid = (Math.max(0, x) + xe) / 2;
      const lbl = C.dayLabel(d.startMs + 6 * HOUR, S.nowMs, tz) === 'Today' ? 'Today' : d.weekday;
      ctx.fillStyle = lbl === 'Today' ? '#ffffff' : 'rgba(255,255,255,0.72)';
      ctx.textAlign = 'center';
      ctx.fillText(lbl, mid, rH - 4);
    }
    // temperature line
    let mn = 1e9, mx = -1e9;
    for (const i of idx) { const v = S.hours[i].feelsF; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mx - mn < 12) { const m = (mx + mn) / 2; mn = m - 6; mx = m + 6; }
    const ty = (v) => top + 4 + (1 - (v - mn) / (mx - mn)) * (plotH - 10);
    const tg = ctx.createLinearGradient(0, top, 0, top + plotH);
    tg.addColorStop(0, 'rgba(255,255,255,0.18)'); tg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    idx.forEach((i, k) => { const x = rx(S.hours[i].ms), y = ty(S.hours[i].feelsF); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.lineTo(rx(S.hours[idx[idx.length - 1]].ms), top + plotH); ctx.lineTo(rx(S.hours[idx[0]].ms), top + plotH); ctx.closePath(); ctx.fillStyle = tg; ctx.fill();
    // the past is dimmed
    const nx = rx(S.nowMs);
    if (nx > 0) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(0, 0, Math.min(nx, rW), rH - labelH); }
    // now tick
    if (nx >= 0 && nx <= rW) { ctx.fillStyle = 'rgba(255,214,120,0.95)'; ctx.fillRect(Math.round(nx) - 0.5, rH - labelH - 6, 1.5, 6); ctx.beginPath(); ctx.arc(nx, rH - labelH - 8, 2.4, 0, 6.2832); ctx.fill(); }
    // the handle
    const hx = clamp(rx(S.T), 0, rW), r = C.sampleAt(S.hours, S.T);
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillRect(Math.round(hx) - 1, 4, 2, rH - labelH - 4);
    ctx.beginPath(); ctx.arc(hx, ty(r.feelsF), 6.5, 0, 6.2832); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(20,40,80,0.55)'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx - 6, 0); ctx.lineTo(hx + 6, 0); ctx.lineTo(hx, 7); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
  }

  /* ---------- time control ---------- */

  function goTo(ms, smooth) {
    S.follow = false;
    stopPlay();
    const to = clamp(ms, S.domain.d0, S.domain.d1 - HOUR);
    if (!smooth) { S.T = to; requestUpdate(); return; }
    const from = S.T, t0 = performance.now();
    const step = (t) => {
      const f = clamp((t - t0) / 420, 0, 1), e = 1 - Math.pow(1 - f, 3);
      S.T = from + (to - from) * e;
      requestUpdate();
      if (f < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function goNow() { S.follow = true; goTo(S.nowMs, true); S.follow = true; }

  let playRaf = 0;
  function startPlay() {
    if (S.playing) return;
    S.playing = true; S.follow = false;
    if (S.T >= S.domain.d1 - 2 * HOUR) S.T = S.domain.d0;
    const btn = $('#playBtn'); clear(btn).append(icon('pause', 18), h('span', null, 'Pause'));
    let last = performance.now();
    const step = (t) => {
      if (!S.playing) return;
      const dt = (t - last) / 1000; last = t;
      S.T += dt * 4 * HOUR; // four hours of weather per second
      if (S.T >= S.domain.d1 - HOUR) { S.T = S.domain.d1 - HOUR; stopPlay(); }
      requestUpdate();
      playRaf = requestAnimationFrame(step);
    };
    playRaf = requestAnimationFrame(step);
    hideHint();
  }
  function stopPlay() {
    if (!S.playing) return;
    S.playing = false; cancelAnimationFrame(playRaf);
    clear($('#playBtn')).append(icon('play', 18), h('span', null, 'Play the week'));
  }
  function hideHint() { if (!S.hinted) { S.hinted = true; store.set('hinted', true); $('#hint').hidden = true; } }

  function bindScrub() {
    const hero = $('#hero');
    let drag = null, vel = 0, inertia = 0;
    const span = () => S.domain.d1 - S.domain.d0;
    // Dragging the sky: a full screen width is 18 hours.
    hero.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || !S.hours) return;
      if (e.target.closest('button, a, input, .chips, #ask, #dress, .wins, #ribbonWrap, .sheet')) return;
      stopPlay(); cancelAnimationFrame(inertia);
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, moved: false };
      vel = 0;
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 4) return;
      if (!drag.moved) { drag.moved = true; try { hero.setPointerCapture(e.pointerId); } catch (x) { /* ok */ } hideHint(); document.body.classList.add('scrubbing'); }
      const now = performance.now();
      const dT = (-dx / Math.max(window.innerWidth, 320)) * 18 * HOUR;
      vel = dT / Math.max(1, now - drag.t);
      S.follow = false;
      S.T = clamp(S.T + dT, S.domain.d0, S.domain.d1 - HOUR);
      drag.x = e.clientX; drag.t = now;
      requestUpdate();
    });
    const end = (e) => {
      if (!drag || (e && drag.id !== e.pointerId)) return;
      const moved = drag.moved; drag = null;
      document.body.classList.remove('scrubbing');
      if (!moved) return;
      // A flick glides on for a few hours at most, easing out.
      const cap = (0.35 * HOUR) / 16;
      let v = clamp(vel, -cap, cap);
      const glide = () => { v *= 0.9; if (Math.abs(v) < (0.01 * HOUR) / 16) return; S.T = clamp(S.T + v * 16, S.domain.d0, S.domain.d1 - HOUR); requestUpdate(); inertia = requestAnimationFrame(glide); };
      inertia = requestAnimationFrame(glide);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);

    // The ribbon: touch or drag anywhere on it to land on that moment.
    let rdrag = false;
    const at = (e) => { const b = ribbon.getBoundingClientRect(); return S.domain.d0 + clamp((e.clientX - b.left) / b.width, 0, 1) * span(); };
    ribbon.addEventListener('pointerdown', (e) => { if (!S.hours) return; stopPlay(); rdrag = true; ribbon.setPointerCapture(e.pointerId); hideHint(); S.follow = false; S.T = clamp(at(e), S.domain.d0, S.domain.d1 - HOUR); document.body.classList.add('scrubbing'); requestUpdate(); });
    ribbon.addEventListener('pointermove', (e) => { if (!rdrag) return; S.T = clamp(at(e), S.domain.d0, S.domain.d1 - HOUR); requestUpdate(); });
    const rend = () => { rdrag = false; document.body.classList.remove('scrubbing'); };
    ribbon.addEventListener('pointerup', rend); ribbon.addEventListener('pointercancel', rend);
    ribbon.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 6 : 1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { goTo(S.T + step * HOUR); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { goTo(S.T - step * HOUR); e.preventDefault(); }
      else if (e.key === 'Home') { goNow(); e.preventDefault(); }
      else if (e.key === 'PageDown') { goTo(S.T + 24 * HOUR); e.preventDefault(); }
      else if (e.key === 'PageUp') { goTo(S.T - 24 * HOUR); e.preventDefault(); }
    });
    window.addEventListener('resize', () => { if (S.hours) { sizeRibbon(); requestUpdate(); } });
  }

  /* ---------- place sheet ---------- */

  let sheetResults = [], sheetMsg = '';
  function openSheet() { $('#sheet').hidden = false; document.body.classList.add('sheet-open'); renderSheet(); setTimeout(() => $('#q').focus(), 50); }
  function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('sheet-open'); sheetResults = []; sheetMsg = ''; }
  function renderSheet() {
    const list = clear($('#sheetList'));
    if (sheetMsg) list.appendChild(h('p', { class: 'sheetmsg' }, sheetMsg));
    if (sheetResults.length) {
      list.appendChild(h('h4', null, 'Matches'));
      for (const p of sheetResults) list.appendChild(h('button', { type: 'button', class: 'prow', onclick: () => choosePlace(p) }, h('span', null, icon('pin', 16)), h('span', { class: 'pn' }, placeTitle(p)), h('span', { class: 'muted small' }, p.country && p.country !== 'US' ? p.country : '')));
    }
    if (S.places.length) {
      list.appendChild(h('h4', null, 'Saved'));
      for (const p of S.places) {
        list.appendChild(h('div', { class: 'prow saved' }, h('button', { type: 'button', class: 'pbtn', onclick: () => choosePlace(p) }, icon('pin', 16), h('span', { class: 'pn' }, placeTitle(p)), S.place && S.place.id === p.id ? h('span', { class: 'muted small' }, 'viewing') : null),
          S.places.length > 1 ? h('button', { type: 'button', class: 'rm', 'aria-label': 'Remove ' + p.name, onclick: () => removePlace(p.id) }, icon('close', 16)) : null));
      }
    }
  }
  async function submitPlace(text) {
    const v = text.trim();
    if (!v) return;
    sheetMsg = 'Looking…'; sheetResults = []; renderSheet();
    try {
      const res = await P.resolvePlaces(v);
      if (res.length === 1) { await choosePlace(res[0]); return; }
      sheetResults = res; sheetMsg = '';
    } catch (e) { sheetMsg = e.message || 'Could not find that place.'; sheetResults = []; }
    renderSheet();
  }
  function useLocation() {
    if (!navigator.geolocation) { sheetMsg = 'This browser cannot share your location. Type a zip code or a city instead.'; renderSheet(); return; }
    sheetMsg = 'Finding you…'; renderSheet();
    navigator.geolocation.getCurrentPosition(
      (pos) => submitPlace(pos.coords.latitude.toFixed(3) + ', ' + pos.coords.longitude.toFixed(3)),
      () => { sheetMsg = 'Location is blocked or unavailable. Type a zip code or a city instead.'; renderSheet(); },
      { timeout: 10000, maximumAge: 600000 });
  }

  /* ---------- versioning, self-update, offline launch ----------
     Same protocol as ClearSky and Studio Phone: the service worker serves the cached page first; the live-version probe (?u=)
     and the update load (?v=) always go to the network. Every build bumps VERSION (build.mjs). */
  const APP_VERSION = '__APP_VERSION__';
  async function checkForUpdate(auto, manual) {
    const bar = $('#updatebar');
    const say = (t) => { if (!bar) return; clear(bar); if (t) bar.appendChild(h('div', { class: 'banner info', role: 'status' }, t)); };
    try {
      if (!/^https?:$/.test(location.protocol)) return;
      const r = await fetch(location.pathname + '?u=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const m = (await r.text()).match(/const APP_VERSION = 'v([\d.]+)'/);
      if (!m) return;
      const live = m[1], mine = (APP_VERSION.match(/^v([\d.]+)$/) || [])[1];
      if (!live || live === mine) { if (manual) { say('You have the latest version (v' + mine + ').'); setTimeout(() => say(''), 3000); } return; }
      const go = () => location.replace(location.pathname + '?v=' + live + location.hash);
      if (auto && !S.hours && !S.loading) { go(); return; } // nothing on screen to lose: update at once
      clear(bar);
      bar.appendChild(h('div', { class: 'banner info update', role: 'status' }, 'MyWeather v' + live + ' is available. ', h('button', { type: 'button', class: 'upd', onclick: go }, 'Update now')));
    } catch (e) { if (manual) { say('Could not check. Are you online?'); setTimeout(() => say(''), 3000); } }
  }
  function registerSW() {
    try {
      if (!('serviceWorker' in navigator)) return;
      if (!(location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) return;
      navigator.serviceWorker.register('sw.js?p=' + encodeURIComponent(location.pathname), { scope: location.pathname }).catch(() => {});
    } catch (e) { /* offline launch is optional */ }
  }

  /* ---------- live: the page keeps itself current ---------- */

  function tick() {
    if (!S.hours) return;
    S.nowMs = Date.now();
    if (S.follow && !S.playing) S.T = clamp(S.nowMs, S.domain.d0, S.domain.d1 - HOUR);
    // Midnight passed (or the hour turned): rebuild the strip so "Now" and the dimmed past stay right.
    if (S.place && todayCols.length && Math.floor(S.nowMs / HOUR) !== Math.floor(S.todayBuiltAt / HOUR)) { S.todayBuiltAt = S.nowMs; renderToday(); }
    requestUpdate();
    // New forecast every ten minutes while the page is open; the provider cache decides if a request is needed.
    if (S.wx && S.nowMs - S.wx.at > 10 * 60000 && !S.loading && document.visibilityState === 'visible') load(S.place);
  }

  /* ---------- wiring ---------- */

  function init() {
    ribbon = $('#ribbon'); rctx = ribbon.getContext('2d');
    sky = K.createSky($('#sky'), { reducedMotion: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches, onPalette: paintChrome });
    bindScrub();
    $('#placeBtn').addEventListener('click', openSheet);
    $('#sheetClose').addEventListener('click', closeSheet);
    $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
    $('#form').addEventListener('submit', (e) => { e.preventDefault(); submitPlace($('#q').value); });
    $('#locate').addEventListener('click', useLocation);
    $('#firstrun').addEventListener('click', openSheet);
    $('#playBtn').addEventListener('click', () => (S.playing ? stopPlay() : startPlay()));
    $('#nowBtn').addEventListener('click', goNow);
    $('#alertPill').addEventListener('click', () => { const c = $('#alertCard'); c.hidden = !c.hidden; if (!c.hidden) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    clear($('#playBtn')).append(icon('play', 18), h('span', null, 'Play the week'));
    clear($('#nowBtn')).append(icon('now', 18), h('span', null, 'Now'));
    clear($('#placeIcon')).append(icon('pin', 16));
    clear($('#placeChev')).append(icon('chevron', 16));
    clear($('#locate')).append(icon('locate', 20), h('span', null, 'Use my location'));
    clear($('#goBtn')).append(icon('search', 18), h('span', { class: 'sr' }, 'Search'));
    window.addEventListener('online', () => { if (S.error) load(S.error.place); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { tick(); checkForUpdate(true); } });
    setInterval(tick, 30000);
    setInterval(() => { if (document.visibilityState === 'visible') refreshFamily(); }, 5 * 60000);
    registerSW();
    setTimeout(() => checkForUpdate(true), 1500);
    const verEl = $('#ver'); verEl.setAttribute('role', 'button'); verEl.tabIndex = 0; verEl.addEventListener('click', () => checkForUpdate(false, true));
    start();
  }

  // The browser's status bar takes the sky's color, so the app feels like one surface.
  let lastChrome = 0;
  function paintChrome(pal) {
    const t = performance.now();
    if (t - lastChrome < 400) return;
    lastChrome = t;
    const c = 'rgb(' + pal.z.map(Math.round) + ')';
    const m = document.querySelector('meta[name="theme-color"]');
    if (m && m.getAttribute('content') !== c) m.setAttribute('content', c);
  }

  async function start() {
    const fromHash = decodeURIComponent((location.hash || '').slice(1)).trim();
    renderFamily();
    if (fromHash) {
      try { const res = await P.resolvePlaces(fromHash); const p = savePlace(res[0]); store.set('cur', p.id); load(p); return; } catch (e) { /* fall through to the saved place */ }
    }
    const cur = S.places.find((p) => p.id === store.get('cur', null)) || S.places[0];
    if (cur) { load(cur); return; }
    // First run: show Andover until the family picks their own places (tap the place name).
    try {
      const res = await P.resolvePlaces('01810');
      const p = savePlace(res[0]);
      store.set('cur', p.id);
      $('#firstrun').hidden = false;
      load(p);
    } catch (e) {
      $('#loading').hidden = true;
      S.error = { message: 'Could not reach the weather service. Check your connection, then choose a place.', place: null };
      renderBanner();
      openSheet();
    }
  }

  window.MyWeatherApp = { S, load, goTo, update, get sky() { return sky; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
