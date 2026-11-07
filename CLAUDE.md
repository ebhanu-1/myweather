# MyWeather

Single-file web app for Bhanu and family: a weather page you scrub through instead of read. The whole screen is the sky; drag it
(or the week timeline) and the sky, the "feels like", what to wear and the plan all follow one moment in time, any hour of the next
7 days. HTML first (same journey as Media Studio and ClearSky), native iOS later when needed.
Design notes and what makes it different: docs/design.md.

## Status (2026-11-07)
- v1.4: the forecast now comes from the National Weather Service for US places (api.weather.gov grid: /points then /gridpoints, expanded to hours, laid over
  Open-Meteo in `overlayNws`; weather type mapped to a WMO code by `nwsCode`). Open-Meteo still supplies what NWS does not publish (UV, sun radiation, cloud layers,
  pressure, the 15-minute rain countdown, yesterday and past hours, air quality, place search) and is the whole forecast outside the US or if NWS fails. UV and
  sun radiation are Open-Meteo's, scaled to the NWS sky cover. "Updated N min ago · NWS" shows which source is live. Checked in a browser at 375 px (Today and Week),
  live check green; not yet on a real phone, and the accuracy of NWS vs Open-Meteo is not yet judged.
- v1.2: two tabs (bottom bar). TODAY (opens first) is locked to now: no sky drag, no ribbon; the hour strip sits in the hero and tapping an hour
  moves the sky there, drifting back to now after 3 idle minutes (or on "Now", or when the app returns to the foreground); good-window chips show today only.
  WEEK is where you travel: sky drag, ribbon, play the week, the day list, windows for the whole week. Details and sun cards show on both; family on Today.
  Forecast cache is now 5 minutes (was 10) and "Updated N min ago" under the hero is tappable to force a refresh. Not yet checked on a real phone.
- v1.1: added "Today, hour by hour" card above "The week" (24-hour strip: icon, feels-like, rain %, sunrise/sunset, past dimmed; follows the scrubbed
  moment, tap an hour to jump the sky there; one-line summary of the rest of today). Logic is `todayHours` in core.js. Also fixed the card grid so a
  wide child can't stretch the page. Checked in a browser at 375 px (evening and midday); not yet on a real phone.
- v1.0 released and live: https://ebhanu-1.github.io/myweather/ (main @ 81a6f6b at release; this file updated after).
- Built and verified in a browser at phone width: sky scene, scrub (sky drag + ribbon), feels-like story, dress, ask-the-sky with
  best windows, rain countdown, week list, sun/moon/sunset card, family orbs, place sheet (zip, city, "lat, lon", location), NWS alerts.
- NOT yet verified: a real phone (touch drag, Add to Home Screen, offline launch via sw.js), the flick inertia cap (added after the
  last browser check), a wide desktop window (only a narrow pane was available), the geolocation button, an active NWS alert.
- Decision: places are per person (browser storage). Family sharing (share link or synced list) was considered and not wanted. Do not build unless asked.
- Next iteration: use it for a few days, then fix what feels off (scoring thresholds, vibe sentences, layout on small phones, sky look).
  Start by reading docs/design.md and the "Ideas not built yet" list below.

## Commands
- npm test                 # node --test, no network
- npm run build            # bumps VERSION (1.0 -> 1.1), inlines src/ into ./index.html (and ./dist), syntax-checks, enforces the size budget
- npm run serve            # static server on :5174 (also reachable from a phone on the same Wi-Fi)
- npm run live             # live end-to-end check against the real APIs (five places, incl. Honolulu for time zones)

## Versioning and release (same scheme as ClearSky and Studio Phone)
- VERSION file holds e.g. `1.0`; every `npm run build` bumps the last part. `node build.mjs --version 2.0` pins a bigger one.
- Shown top right of the app (tap it to check for an update). The app probes the live page (`?u=`) at launch and each time it returns
  to the foreground; with nothing on screen it reloads to the new version (`?v=`), otherwise it shows "Update now".
- public/sw.js: cache-first page for offline launch (the background refresh revalidates past the 10-minute HTTP cache, v1.3); `?u=` always goes to the network, `?v=` fetches fresh and replaces the cache.
- Release: `npm run build`, commit, `git push`. GitHub Pages serves main at https://ebhanu-1.github.io/myweather/ (repo ebhanu-1/myweather).
- US units only (°F, mph, in, mi). Open-Meteo is asked for US units directly; there is no conversion layer.

## Layout (borrowed from ClearSky where noted)
- src/core.js       pure: time zones + sun position + sunrise/sunset (ClearSky), moon, WMO codes, hourly sampling, the feel story
                    (wind chill / heat index drivers, headline, vibe sentence), dress, 8 activities with scores and best windows,
                    outlook, vs-yesterday, 15-minute rain countdown, sunset color, day grouping, today hour-by-hour rows + summary (`todayHours`)
- src/providers.js  network (ClearSky's http/cache/ProviderError/zip lookup, new weather calls): NWS grid forecast (US) over one Open-Meteo forecast call
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
- Pointer drag on the hero scrubs time (a screen width is 18 hours) on the Week tab only; the ribbon is a slider (arrow keys move an hour).
- Anything that takes over the clock (tab switch, Now, play) must stop a flick's glide and a smooth goTo (`stopMotion`).
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
