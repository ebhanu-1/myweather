# MyWeather

Single-file web app for Bhanu and family: a weather page you scrub through instead of read. The whole screen is the sky; drag it
(or the week timeline) and the sky, the "feels like", what to wear and the plan all follow one moment in time, any hour of the next
7 days. HTML first (same journey as Media Studio and ClearSky), native iOS later when needed.
Design notes and what makes it different: docs/design.md.

## Commands
- npm test                 # node --test, no network
- npm run build            # bumps VERSION (1.0 -> 1.1), inlines src/ into ./index.html (and ./dist), syntax-checks, enforces the size budget
- npm run serve            # static server on :5174 (also reachable from a phone on the same Wi-Fi)
- npm run live             # live end-to-end check against the real APIs (five places, incl. Honolulu for time zones)

## Versioning and release (same scheme as ClearSky and Studio Phone)
- VERSION file holds e.g. `1.0`; every `npm run build` bumps the last part. `node build.mjs --version 2.0` pins a bigger one.
- Shown top right of the app (tap it to check for an update). The app probes the live page (`?u=`) at launch and each time it returns
  to the foreground; with nothing on screen it reloads to the new version (`?v=`), otherwise it shows "Update now".
- public/sw.js: cache-first page for offline launch; `?u=` always goes to the network, `?v=` fetches fresh and replaces the cache.
- Release: `npm run build`, commit, `git push`. GitHub Pages serves main at https://ebhanu-1.github.io/myweather/ (repo ebhanu-1/myweather).
- US units only (°F, mph, in, mi). Open-Meteo is asked for US units directly; there is no conversion layer.

## Layout (borrowed from ClearSky where noted)
- src/core.js       pure: time zones + sun position + sunrise/sunset (ClearSky), moon, WMO codes, hourly sampling, the feel story
                    (wind chill / heat index drivers, headline, vibe sentence), dress, 8 activities with scores and best windows,
                    outlook, vs-yesterday, 15-minute rain countdown, sunset color, day grouping
- src/providers.js  network (ClearSky's http/cache/ProviderError/zip lookup, new weather calls): one Open-Meteo forecast call
                    (hourly + minutely_15 + current, yesterday + 8 days), air quality, NWS alerts, place search, multi-place "now"
- src/sky.js        the canvas scene: palette by sun height, stars, moon phase, 3 cloud layers drifting with the real wind,
                    rain/snow/thunder/fog/haze, swaying trees, frost (cold) and shimmer (hot). Pure `skyPalette` and `stateFrom` are tested
- src/app.js        UI (DOM built with textContent only), one `update()` driven by `S.T` (the scrubbed moment)
- src/style.css, src/index.template.html; test/ (node:test); public/ (manifest, icons, sw.js, copied next to index.html on build)

## Rules
- core.js has no I/O and no DOM; providers.js never imports core. Only app.js uses both. sky.js's `createSky` is the only canvas code.
- Time is UTC ms; a place's IANA tz is used to label and cut days. Open-Meteo is called with `timezone=GMT`.
- No thresholds in the UI. Activity factors, dress bands and vibe rules live in core.js; changing one means updating its test in the same commit.
- Missing data never scores as 0: a null AQI is "fine", a null pop is 0 (see `rate`, `dress`).
- Tests never call live APIs. `npm run live` is the only networked check.
- No emoji glyphs anywhere (iOS renders them inconsistently): icons are drawn SVG.
- One HTML file, no runtime CDN, under 200 KB gzipped. Dark glass cards over the sky; text is white with a scrim for contrast.
- Pointer drag on the hero scrubs time (a screen width is 18 hours); the ribbon is a slider (arrow keys move an hour).
- The browser pane pauses requestAnimationFrame when hidden: show it (ccd_view show_pane) before testing sky animation.

## Definition of done
Tests green, `npm run build` green, `npm run live` all places OK, and the page checked in a browser at phone width (375 px) at three
moments (day, rain, night) with an activity selected.

## Ideas not built yet (v2+)
- Ask the sky by voice / free text ("when can I hang laundry Friday?")
- Family "who is where" push: shared saved places over a link instead of per-browser storage
- Notifications for rain starting at a saved place (needs a server or the native app)
- Native iOS (WidgetKit widget showing the sky for Home), reuse core.js logic in Swift
- Pollen (needs a US source), tide/surf, radar tiles
