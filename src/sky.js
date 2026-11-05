/* MyWeather sky: the whole screen is the weather. A canvas scene driven by one "state" object (sun and moon position,
 * cloud layers, rain or snow, wind, fog, haze, how hot or cold it feels). The scene eases toward whatever state it is
 * given, so scrubbing through time morphs the sky instead of jumping.
 * skyPalette() and stateFrom() are pure (tested in Node); createSky() needs a canvas.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MyWeatherSky = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, f) => a + (b - a) * f;
  const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

  /* ---------- colors ---------- */

  const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const mixc = (a, b, f) => [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
  const css = (c, a) => 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (a == null ? 1 : +a.toFixed(3)) + ')';

  // [sun elevation in degrees, zenith, upper, horizon] colors, clear air.
  const STOPS = [
    [-20, '#040815', '#070f26', '#101a3c'],
    [-12, '#07102a', '#101d46', '#25305f'],
    [-6, '#152654', '#3b3f7a', '#b4627a'],
    [-1.5, '#2a3f7e', '#8a5a94', '#f39a62'],
    [3, '#3d5fa8', '#8f86b8', '#ffc27a'],
    [9, '#4a79c0', '#8fb0dc', '#ffe0ae'],
    [20, '#3a82d8', '#78b0e8', '#cfe7f8'],
    [45, '#2a78d6', '#5da4ec', '#b6dcf8'],
  ].map((s) => ({ e: s[0], z: hex(s[1]), u: hex(s[2]), h: hex(s[3]) }));

  function clearColors(elev) {
    const e = clamp(elev, STOPS[0].e, STOPS[STOPS.length - 1].e);
    let i = 0;
    while (i < STOPS.length - 2 && e > STOPS[i + 1].e) i++;
    const a = STOPS[i], b = STOPS[i + 1], f = clamp((e - a.e) / (b.e - a.e), 0, 1);
    return { z: mixc(a.z, b.z, f), u: mixc(a.u, b.u, f), h: mixc(a.h, b.h, f) };
  }

  const GREY_DAY = { z: hex('#5f6d7d'), u: hex('#8593a2'), h: hex('#c3ccd4') };
  const GREY_NIGHT = { z: hex('#0b0f17'), u: hex('#141a26'), h: hex('#252d3c') };
  const FOG_DAY = hex('#b7c1c8'), FOG_NIGHT = hex('#232a33');
  const HAZE = hex('#c9a77f');

  // Sky colors for a sun elevation and how the air is dressed: overcast 0..1, rain 0..1, fog 0..1, haze 0..1.
  function skyPalette(elev, o) {
    const w = o || {};
    const base = clearColors(elev);
    const day = clamp((elev + 4) / 12, 0, 1); // 0 at night, 1 in full day
    const grey = { z: mixc(GREY_NIGHT.z, GREY_DAY.z, day), u: mixc(GREY_NIGHT.u, GREY_DAY.u, day), h: mixc(GREY_NIGHT.h, GREY_DAY.h, day) };
    // Keep a hint of the twilight glow under cloud so dusk is still dusk.
    const tw = clamp(1 - Math.abs(elev + 2) / 8, 0, 1) * 0.28;
    const gs = clamp(Math.pow(clamp(w.overcast || 0, 0, 1), 0.85) * 0.88 + clamp(w.rain || 0, 0, 1) * 0.1, 0, 0.97);
    const out = {};
    for (const k of ['z', 'u', 'h']) {
      let c = mixc(base[k], grey[k], gs);
      if (tw > 0 && k === 'h') c = mixc(c, base.h, tw * gs);
      if (w.rain) c = mixc(c, [10, 14, 22], clamp(w.rain, 0, 1) * 0.28 * (0.4 + day * 0.6));
      if (w.haze) c = mixc(c, HAZE, clamp(w.haze, 0, 1) * (k === 'h' ? 0.5 : k === 'u' ? 0.3 : 0.15) * (0.2 + 0.8 * day));
      if (w.fog) c = mixc(c, mixc(FOG_NIGHT, FOG_DAY, day), clamp(w.fog, 0, 1) * (k === 'z' ? 0.7 : 0.92));
      out[k] = c;
    }
    return out;
  }

  // The light that falls on cloud tops: white by day, peach at the horizon, blue-grey at night.
  function cloudLight(elev) {
    const day = clamp((elev + 4) / 14, 0, 1);
    const dusk = clamp(1 - Math.abs(elev - 1) / 7, 0, 1);
    let c = mixc(hex('#3a4660'), hex('#ffffff'), day);
    c = mixc(c, hex('#ffb78a'), dusk * 0.6);
    return c;
  }
  function cloudShade(elev) {
    const day = clamp((elev + 4) / 14, 0, 1);
    return mixc(hex('#10151f'), hex('#8b97a6'), day);
  }

  /* ---------- turning weather into scene state (pure) ---------- */

  // r: sampled weather {cloud*, precipIn, snowIn, code, visMi, windMph, windDir, feelsF, aqi, rad}
  // c: context {elev, az, moon:{elevDeg, azDeg, illum, waxing}}
  function stateFrom(r, c, info, opts) {
    const o = opts || {};
    const kind = info.kind;
    const p = r.precipIn || 0;
    let rain = clamp(Math.sqrt(p / 0.22), 0, 1);
    if (info.wet && rain < 0.15 && kind !== 'snow') rain = Math.max(rain, 0.1 + 0.08 * info.wet);
    if (kind !== 'rain' && kind !== 'thunder' && kind !== 'snow' && (r.snowIn || 0) === 0 && p < 0.004) rain = 0;
    const snowing = kind === 'snow' || ((r.snowIn || 0) > 0.002 && r.tempF <= 34);
    const fog = kind === 'fog' ? 0.9 : isNum(r.visMi) ? clamp(1 - r.visMi / 4, 0, 0.8) : 0;
    const aod = isNum(r.aqi) ? clamp((r.aqi - 60) / 120, 0, 1) : 0;
    const cl = (v, fallback) => (isNum(v) ? v / 100 : fallback);
    const total = cl(r.cloud, 0.3);
    let low = cl(r.cloudLow, total * 0.6), mid = cl(r.cloudMid, total * 0.5), high = cl(r.cloudHigh, total * 0.4);
    if (kind === 'cloudy') { low = Math.max(low, 0.55); mid = Math.max(mid, 0.7); }
    if (info.wet) { low = Math.max(low, 0.75); mid = Math.max(mid, 0.8); }
    return {
      elev: c.elev, az: c.az, moonElev: c.moon.elevDeg, moonAz: c.moon.azDeg, moonIllum: c.moon.illum, moonWaxing: c.moon.waxing ? 1 : 0,
      low, mid, high, rain: snowing ? 0 : rain, snow: snowing ? Math.max(0.2, clamp(Math.sqrt(Math.max(p, (r.snowIn || 0) / 8) / 0.15), 0, 1)) : 0,
      thunder: kind === 'thunder' ? 1 : 0, fog, haze: aod, wind: r.windMph || 0, windDir: isNum(r.windDir) ? r.windDir : 270,
      feels: isNum(r.feelsF) ? r.feelsF : 65, dayAmt: clamp((c.elev + 4) / 12, 0, 1), snowCover: o.snowCover ? 1 : 0, sunDim: 0,
    };
  }

  const overcastOf = (s) => clamp(s.low * 0.55 + s.mid * 0.35 + s.high * 0.1, 0, 1);

  /* ---------- the canvas scene ---------- */

  function createSky(canvas, opts) {
    const o = opts || {};
    const ctx = canvas.getContext('2d');
    const reduced = !!o.reducedMotion;
    let W = 0, H = 0, dpr = 1, horizon = 0;
    const target = stateFrom({ cloud: 20, tempF: 65, feelsF: 65, windMph: 5 }, { elev: 30, az: 180, moon: { elevDeg: -30, azDeg: 0, illum: 0.5, waxing: true } }, { kind: 'clear', wet: 0 });
    const cur = Object.assign({}, target);
    let seeded = false;
    let last = 0, running = false, raf = 0, flash = 0, nextFlash = 3;
    let drift = 0, sway = 0;

    // Deterministic pseudo-random so the stars and clouds look the same every time.
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

    const stars = [];
    for (let i = 0; i < 160; i++) stars.push({ x: rnd(), y: Math.pow(rnd(), 1.4), r: 0.4 + rnd() * 1.1, tw: rnd() * 6.28, sp: 0.6 + rnd() * 1.4 });
    const layers = [
      { name: 'high', n: 9, y0: 0.06, y1: 0.28, size: 0.55, speed: 0.35, alpha: 0.5, flat: 0.34, clouds: [] },
      { name: 'mid', n: 9, y0: 0.14, y1: 0.4, size: 0.85, speed: 0.6, alpha: 0.72, flat: 0.5, clouds: [] },
      { name: 'low', n: 8, y0: 0.3, y1: 0.58, size: 1.25, speed: 1, alpha: 0.9, flat: 0.62, clouds: [] },
    ];
    for (const L of layers) {
      for (let i = 0; i < L.n; i++) {
        const puffs = [];
        const np = 5 + Math.floor(rnd() * 5);
        for (let k = 0; k < np; k++) puffs.push({ dx: (rnd() - 0.5) * 1.5, dy: (rnd() - 0.5) * 0.3 - Math.abs(rnd() - 0.5) * 0.15, r: 0.28 + rnd() * 0.3 });
        L.clouds.push({ x: rnd() * 1.4 - 0.2, y: L.y0 + rnd() * (L.y1 - L.y0), s: 0.7 + rnd() * 0.7, puffs, order: (i + rnd() * 0.5) / L.n });
      }
    }
    // Puff sprite: a soft white disc, tinted at draw time through globalAlpha and a second shaded pass.
    const puff = document.createElement('canvas');
    puff.width = puff.height = 128;
    {
      const g = puff.getContext('2d');
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.45, 'rgba(255,255,255,0.75)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 128, 128);
    }
    const tint = document.createElement('canvas');
    tint.width = tint.height = 128;
    const tintCtx = tint.getContext('2d');
    function tintedPuff(color) {
      tintCtx.clearRect(0, 0, 128, 128);
      tintCtx.globalCompositeOperation = 'source-over';
      tintCtx.drawImage(puff, 0, 0);
      tintCtx.globalCompositeOperation = 'source-in';
      tintCtx.fillStyle = css(color, 1);
      tintCtx.fillRect(0, 0, 128, 128);
      return tint;
    }

    const drops = [];
    const flakes = [];
    const leaves = [];
    const trees = [];
    function seedWorld() {
      drops.length = 0; flakes.length = 0; leaves.length = 0; trees.length = 0;
      const area = (W * H) / (390 * 844);
      for (let i = 0; i < Math.round(420 * area); i++) drops.push({ x: rnd(), y: rnd(), z: 0.5 + rnd() * 0.8, i: rnd() });
      for (let i = 0; i < Math.round(240 * area); i++) flakes.push({ x: rnd(), y: rnd(), z: 0.4 + rnd() * 0.9, ph: rnd() * 6.28, i: rnd() });
      for (let i = 0; i < 26; i++) leaves.push({ x: rnd(), y: 0.55 + rnd() * 0.3, z: 0.5 + rnd(), ph: rnd() * 6.28, i: rnd() });
      for (let i = 0; i < 9; i++) trees.push({ x: -0.05 + (i + rnd() * 0.7) / 8.4, h: 0.07 + rnd() * 0.07, kind: rnd() < 0.55 ? 'pine' : 'round', ph: rnd() * 6.28 });
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
      W = Math.round(w); H = Math.round(h);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      horizon = H * 0.6;
      seedWorld();
      if (!running) draw(0);
    }

    /* easing toward the target state */
    const NUM = ['elev', 'az', 'moonElev', 'moonAz', 'moonIllum', 'moonWaxing', 'low', 'mid', 'high', 'rain', 'snow', 'thunder', 'fog', 'haze', 'wind', 'feels', 'dayAmt', 'snowCover'];
    function ease(dt) {
      const k = reduced || !seeded ? 1 : 1 - Math.exp(-dt * 7);
      for (const n of NUM) cur[n] += (target[n] - cur[n]) * k;
      let d = ((target.windDir - cur.windDir + 540) % 360) - 180;
      cur.windDir = (cur.windDir + d * k + 360) % 360;
      seeded = true;
    }

    /* drawing */
    const sunX = (az) => W * clamp(0.5 + (az - 180) / 115, -0.2, 1.2);
    const bodyY = (elev) => horizon - (clamp(elev, -12, 70) / 70) * (horizon - H * 0.2);

    function drawSky(pal) {
      const g = ctx.createLinearGradient(0, 0, 0, horizon + 10);
      g.addColorStop(0, css(pal.z));
      g.addColorStop(0.55, css(pal.u));
      g.addColorStop(1, css(pal.h));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    function drawStars(t, night, oc) {
      const a = clamp(night * (1 - oc * 1.25), 0, 1);
      if (a <= 0.01) return;
      for (const s of stars) {
        const tw = 0.65 + 0.35 * Math.sin(t * s.sp + s.tw);
        ctx.fillStyle = 'rgba(255,255,255,' + (a * tw * (0.5 + s.r * 0.4)).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * horizon * 0.95, s.r, 0, 6.2832);
        ctx.fill();
      }
    }

    function drawMoon(oc) {
      const el = cur.moonElev;
      if (el < -8) return;
      const x = sunX(cur.moonAz), y = bodyY(el), r = Math.max(20, Math.min(W, H) * 0.052);
      const vis = clamp((el + 6) / 8, 0, 1) * clamp(1 - oc * 0.92, 0, 1) * clamp(1 - cur.dayAmt * 0.9, 0.1, 1);
      if (vis <= 0.09) return;
      const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 5);
      glow.addColorStop(0, 'rgba(210,225,255,' + (0.28 * vis * (0.3 + cur.moonIllum)).toFixed(3) + ')');
      glow.addColorStop(1, 'rgba(210,225,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
      ctx.globalAlpha = vis;
      ctx.fillStyle = 'rgba(40,52,84,' + (0.9 * (1 - cur.dayAmt)).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      const ill = clamp(cur.moonIllum, 0, 1), rx = r * Math.abs(1 - 2 * ill), right = cur.moonWaxing > 0.5;
      ctx.fillStyle = '#f2efe2';
      ctx.beginPath();
      ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, !right);
      const crescent = ill < 0.5;
      ctx.ellipse(x, y, Math.max(0.01, rx), r, 0, Math.PI / 2, crescent === right ? -Math.PI / 2 : Math.PI * 1.5, crescent === right);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    function drawSun(oc, fogA) {
      const el = cur.elev;
      if (el < -10) return;
      const x = sunX(cur.az), y = bodyY(el);
      const lowSun = clamp(1 - el / 22, 0, 1);
      const col = mixc([255, 244, 214], [255, 150, 70], lowSun);
      const dim = clamp(1 - oc * 0.9 - fogA * 0.4, 0.05, 1);
      const fade = clamp((el + 8) / 8, 0, 1);
      const R = Math.min(W, H) * (0.55 + lowSun * 0.25);
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, css(col, 0.55 * dim * fade));
      g.addColorStop(0.25, css(col, 0.2 * dim * fade));
      g.addColorStop(1, css(col, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, horizon + 20);
      if (el > -2) {
        const r = Math.min(W, H) * (0.036 + lowSun * 0.014);
        ctx.fillStyle = css(mixc([255, 252, 238], [255, 190, 110], lowSun), clamp(dim * 1.15, 0, 1) * fade);
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
      }
    }

    function drawClouds(t, dt) {
      const light = cloudLight(cur.elev), shade = cloudShade(cur.elev);
      const wd = ((cur.windDir + 180) * Math.PI) / 180; // direction the air travels toward
      const vx = -Math.sin(wd); // facing south: east is left
      const wind = 4 + cur.wind * 1.9;
      const cover = { high: cur.high, mid: cur.mid, low: cur.low };
      for (const L of layers) {
        const cv = cover[L.name];
        if (cv <= 0.02) continue;
        const px = (L.speed * wind * vx * dt) / Math.max(W, 1) * 0.02 * 60;
        for (const c of L.clouds) {
          c.x += px;
          if (c.x > 1.35) c.x -= 1.7; else if (c.x < -0.35) c.x += 1.7;
          // Clouds fade in one by one as coverage rises; at high coverage they all merge into a deck.
          const a = clamp(cv * 1.25 * 1.15 - c.order * 1.05, 0, 1) * L.alpha;
          if (a <= 0.01) continue;
          const base = Math.min(W, 820) * 0.3 * L.size * c.s * (0.8 + cv * 0.6);
          const cx = c.x * W, cy = c.y * horizon;
          const flat = L.flat;
          for (let pass = 0; pass < 2; pass++) {
            const col = pass === 0 ? shade : light;
            const spr = tintedPuff(col);
            ctx.globalAlpha = a * (pass === 0 ? 0.55 : 0.75);
            for (const p of c.puffs) {
              const rr = base * p.r * 1.7;
              const ox = pass === 0 ? 0 : -rr * 0.12, oy = pass === 0 ? rr * 0.14 : -rr * 0.12;
              ctx.drawImage(spr, cx + p.dx * base + ox - rr, cy + p.dy * base * flat * 2 + oy - rr * flat, rr * 2, rr * 2 * flat);
            }
          }
        }
      }
      ctx.globalAlpha = 1;
      // A full deck: a soft grey veil so a 100% overcast reads as one lid, not many clouds.
      const deck = clamp((cur.low * 0.6 + cur.mid * 0.4 - 0.55) / 0.45, 0, 1);
      if (deck > 0) {
        const g = ctx.createLinearGradient(0, 0, 0, horizon);
        g.addColorStop(0, css(mixc(shade, light, 0.25), 0.55 * deck));
        g.addColorStop(1, css(mixc(shade, light, 0.55), 0.35 * deck));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, horizon);
      }
    }

    function groundColors() {
      const d = cur.dayAmt;
      const far = mixc(hex('#0a1019'), hex('#587a63'), d);
      const near = mixc(hex('#06090f'), hex('#2f5a3b'), d);
      const dusk = clamp(1 - Math.abs(cur.elev + 2) / 10, 0, 1) * 0.35;
      let f = mixc(far, hex('#6c5a6e'), dusk), n = mixc(near, hex('#2f2a3c'), dusk);
      const snow = cur.snowCover;
      if (snow > 0) { f = mixc(f, mixc(hex('#aab6c6'), hex('#f0f4f9'), d), snow * 0.9); n = mixc(n, mixc(hex('#8d99ab'), hex('#e6ecf4'), d), snow * 0.9); }
      return { far: f, near: n };
    }

    function hill(y0, amp, freq, phase, color) {
      ctx.fillStyle = css(color);
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W + 8; x += 8) {
        const u = x / W;
        ctx.lineTo(x, y0 - amp * (0.55 * Math.sin(u * freq + phase) + 0.3 * Math.sin(u * freq * 2.3 + phase * 1.7) + 0.15 * Math.sin(u * freq * 5.1)));
      }
      ctx.lineTo(W + 8, H);
      ctx.closePath();
      ctx.fill();
    }

    function drawGround(t, fogA) {
      const gc = groundColors();
      hill(horizon + 2, H * 0.03, 5.2, 1.1, mixc(gc.far, cloudLight(cur.elev), 0.08));
      if (fogA > 0.05) {
        const g = ctx.createLinearGradient(0, horizon - H * 0.12, 0, horizon + H * 0.08);
        const fc = mixc(FOG_NIGHT, FOG_DAY, cur.dayAmt);
        g.addColorStop(0, css(fc, 0));
        g.addColorStop(0.6, css(fc, 0.75 * fogA));
        g.addColorStop(1, css(fc, 0.9 * fogA));
        ctx.fillStyle = g;
        ctx.fillRect(0, horizon - H * 0.12, W, H * 0.2);
      }
      hill(horizon + H * 0.045, H * 0.045, 3.1, 2.4, gc.near);
      // Trees sway with the wind: amplitude and speed both grow with mph.
      const amp = clamp(cur.wind / 28, 0.05, 1.4);
      const col = mixc(gc.near, [0, 0, 0], 0.25 + (1 - cur.dayAmt) * 0.2);
      ctx.fillStyle = css(col);
      const wdir = Math.sin(((cur.windDir + 180) * Math.PI) / 180) > 0 ? -1 : 1;
      for (const tr of trees) {
        const x = tr.x * W, hh = H * tr.h, baseY = horizon + H * 0.05 - (Math.sin(tr.x * 3.1 + 2.4) * H * 0.004);
        const lean = (Math.sin(t * (1.1 + cur.wind * 0.05) + tr.ph) * 0.55 + 0.7 * wdir * clamp(cur.wind / 25, 0, 1.2)) * amp * hh * 0.18;
        ctx.beginPath();
        if (tr.kind === 'pine') {
          ctx.moveTo(x - hh * 0.2, baseY);
          ctx.lineTo(x + lean * 0.6 - hh * 0.12, baseY - hh * 0.45);
          ctx.lineTo(x + lean * 0.9 - hh * 0.07, baseY - hh * 0.45);
          ctx.lineTo(x + lean, baseY - hh);
          ctx.lineTo(x + lean * 0.9 + hh * 0.07, baseY - hh * 0.45);
          ctx.lineTo(x + lean * 0.6 + hh * 0.12, baseY - hh * 0.45);
          ctx.lineTo(x + hh * 0.2, baseY);
        } else {
          ctx.moveTo(x - hh * 0.03, baseY);
          ctx.lineTo(x + lean * 0.5 - hh * 0.03, baseY - hh * 0.5);
          ctx.ellipse(x + lean, baseY - hh * 0.72, hh * 0.3, hh * 0.3, 0, Math.PI * 0.8, Math.PI * 0.2 + Math.PI * 2, false);
          ctx.lineTo(x + lean * 0.5 + hh * 0.03, baseY - hh * 0.5);
          ctx.lineTo(x + hh * 0.03, baseY);
        }
        ctx.closePath();
        ctx.fill();
      }
      hill(horizon + H * 0.12, H * 0.05, 2.2, 0.4, mixc(gc.near, [0, 0, 0], 0.18));
    }

    function drawRain(t, dt) {
      if (cur.rain <= 0.02) return;
      const n = Math.round(drops.length * cur.rain);
      const slant = clamp(Math.sin(((cur.windDir + 180) * Math.PI) / 180) * (0.12 + cur.wind / 60), -0.7, 0.7) * -1;
      const day = cur.dayAmt;
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const d = drops[i];
        d.y += (dt * (0.9 + d.z * 0.9) * (0.9 + cur.rain * 0.5)) * 1.25;
        d.x += dt * slant * 0.5 * (0.9 + d.z);
        if (d.y > 1.05) { d.y -= 1.15; d.x = rnd(); }
        if (d.x > 1.1) d.x -= 1.2; else if (d.x < -0.1) d.x += 1.2;
        const len = (10 + d.z * 16) * (0.6 + cur.rain * 0.6);
        const x = d.x * W, y = d.y * H;
        ctx.strokeStyle = 'rgba(' + Math.round(lerp(150, 215, day)) + ',' + Math.round(lerp(175, 232, day)) + ',' + Math.round(lerp(215, 255, day)) + ',' + (0.18 + d.z * 0.25).toFixed(2) + ')';
        ctx.lineWidth = 0.7 + d.z * 0.7;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + slant * len, y - len); ctx.stroke();
      }
    }

    function drawSnow(t, dt) {
      if (cur.snow <= 0.02) return;
      const n = Math.round(flakes.length * cur.snow);
      const push = Math.sin(((cur.windDir + 180) * Math.PI) / 180) * clamp(cur.wind / 20, 0, 1.5) * -0.05;
      for (let i = 0; i < n; i++) {
        const f = flakes[i];
        f.y += dt * (0.07 + f.z * 0.1);
        f.x += dt * (push + Math.sin(t * 0.9 + f.ph) * 0.018);
        if (f.y > 1.04) { f.y -= 1.1; f.x = rnd(); }
        if (f.x > 1.05) f.x -= 1.1; else if (f.x < -0.05) f.x += 1.1;
        ctx.fillStyle = 'rgba(255,255,255,' + (0.45 + f.z * 0.4).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(f.x * W, f.y * H, 1 + f.z * 1.7, 0, 6.2832); ctx.fill();
      }
    }

    // Leaves and dust ride the wind once it picks up, so a gusty day looks gusty even without trees in view.
    function drawWind(t, dt) {
      const k = clamp((cur.wind - 9) / 22, 0, 1);
      if (k <= 0.02 || cur.rain > 0.5) return;
      const dirx = -Math.sin(((cur.windDir + 180) * Math.PI) / 180);
      const sgn = dirx >= 0 ? 1 : -1;
      const n = Math.round(leaves.length * k);
      for (let i = 0; i < n; i++) {
        const l = leaves[i];
        l.x += sgn * dt * (0.12 + cur.wind * 0.012) * l.z;
        l.y += Math.sin(t * 2 + l.ph) * dt * 0.05 - dt * 0.004;
        if (l.x > 1.05) { l.x = -0.05; l.y = 0.5 + rnd() * 0.35; } else if (l.x < -0.05) { l.x = 1.05; l.y = 0.5 + rnd() * 0.35; }
        const a = (0.25 + l.z * 0.3) * (0.3 + cur.dayAmt * 0.7);
        ctx.fillStyle = (l.i < 0.5 ? 'rgba(214,160,70,' : 'rgba(150,170,90,') + a.toFixed(2) + ')';
        ctx.save();
        ctx.translate(l.x * W, l.y * H);
        ctx.rotate(t * 3 * l.z + l.ph);
        ctx.fillRect(-2.5 * l.z, -1.2, 5 * l.z, 2.4);
        ctx.restore();
      }
    }

    function drawMood(t) {
      // Cold frosts the edges; heat glows from below and shimmers the horizon.
      const f = cur.feels;
      if (f <= 34) {
        const k = clamp((34 - f) / 34, 0, 1);
        const g = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.max(W, H) * 0.78);
        g.addColorStop(0, 'rgba(210,232,255,0)');
        g.addColorStop(1, 'rgba(210,232,255,' + (0.1 + k * 0.38).toFixed(3) + ')');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      } else if (f >= 86) {
        const k = clamp((f - 86) / 24, 0, 1);
        const g = ctx.createLinearGradient(0, H, 0, H * 0.35);
        g.addColorStop(0, 'rgba(255,140,40,' + (0.12 + k * 0.28).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(255,140,40,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        if (cur.dayAmt > 0.3 && !reduced) {
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.05 + k * 0.06).toFixed(3) + ')';
          ctx.lineWidth = 1.2;
          for (let i = 0; i < 5; i++) {
            const y = horizon - 4 - i * 7;
            ctx.beginPath();
            for (let x = 0; x <= W; x += 10) ctx.lineTo(x, y + Math.sin(x * 0.045 + t * (2 + i)) * (1.5 + k * 2));
            ctx.stroke();
          }
        }
      }
    }

    function draw(dt, t) {
      t = t || 0;
      const oc = overcastOf(cur);
      const pal = skyPalette(cur.elev, { overcast: oc, rain: cur.rain, fog: cur.fog, haze: cur.haze });
      drawSky(pal);
      drawStars(t, clamp((-cur.elev - 4) / 12, 0, 1), oc);
      drawSun(oc, cur.fog);
      drawMoon(oc);
      drawClouds(t, dt);
      if (cur.thunder > 0.5 && flash > 0.01) {
        ctx.fillStyle = 'rgba(235,240,255,' + (flash * 0.55).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
      }
      drawGround(t, cur.fog);
      drawWind(t, dt);
      drawRain(t, dt);
      drawSnow(t, dt);
      drawMood(t);
      o.onPalette && o.onPalette(pal);
    }

    function frame(ts) {
      if (!running) return;
      const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
      last = ts;
      ease(dt);
      drift += dt;
      if (cur.thunder > 0.5) {
        nextFlash -= dt;
        if (nextFlash <= 0) { flash = 1; nextFlash = 2.5 + rnd() * 6; }
      }
      flash *= Math.exp(-dt * 7);
      try { draw(dt, drift); } catch (e) { if (!frame.warned) { frame.warned = true; console.error('sky draw failed', e); } }
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running) return;
      running = true; last = performance.now();
      if (reduced) { ease(1); draw(0, 0); running = false; return; }
      raf = requestAnimationFrame(frame);
    }
    function stop() { running = false; cancelAnimationFrame(raf); }
    function set(state, instant) {
      Object.assign(target, state);
      if (instant || !seeded) { Object.assign(cur, target); seeded = true; }
      if (reduced) { Object.assign(cur, target); draw(0, 0); }
    }

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    resize();
    start();
    return { set, resize, start, stop, draw, state: cur, target };
  }

  return { skyPalette, stateFrom, cloudLight, createSky, overcastOf, clearColors };
});
