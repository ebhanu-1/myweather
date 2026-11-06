# MyWeather design

## The problem with weather apps
Every weather app is a dashboard: a number, an icon, a list of hours, a list of days, and the rest is a page of tiles you have to
interpret. Nobody in the family wants data; they want answers: do I need a jacket, will it rain on the school run, when can I
hang the laundry, is Mom's weather bad. And the screen never *feels* like anything.

## The idea: time is the interface
One number, `S.T`, is the moment you are looking at. Everything is a function of it.
- The **sky** is the page: sun and moon on their real arcs, three cloud layers drifting with the real wind speed and direction,
  rain/snow/thunder/fog/haze, trees that sway at the real wind speed, frost at the edges when it feels freezing, shimmer when hot.
- You **drag the sky** (a screen width is 18 hours) or the **week ribbon** (feels-like line, rain bars, night shading) to travel.
  The sky morphs smoothly, so you see tomorrow's afternoon rather than read it.
- **Play the week** streams 4 hours of weather per second. The page also refreshes itself: the clock, the rain countdown and the
  forecast stay current while it is open (forecast every 10 minutes, family every 5).

## Two tabs: Today and Week
Time travel is easy to trigger by accident (one drag of the sky moves "now" away), so the app is split. Today is about now and the rest of today:
the sky is not draggable, the hour strip is the only way to look at another hour, and it returns to now by itself. Week keeps the original
scrub-through-the-sky experience for planning days ahead. Same sky behind both.

## Today, hour by hour
In the Today hero sits a strip of today's 24 hours (icon, feels-like, rain chance, sunrise and sunset hours; night hours shaded, the past dimmed).
It is the glanceable answer to "what is today doing" before the days that follow. It shares the one clock: the hour being looked at is
highlighted and scrolled into view as you scrub, and tapping an hour moves the sky there. The sentence above it says when it is warmest
and coldest and when rain comes, for the rest of the day only.

## Feels like, in plain words
`feelsStory` names the word (bitter... dangerously hot), at most two tags (breezy, muggy, sunny...), and the drivers: NWS wind chill
and Rothfusz heat index explain the gap between air and feel ("Wind takes 6° off", "Humidity adds 4°", "Sunshine adds 3°").
`vibe` is one rule-ordered sentence for the moment ("Crisp and bright. A proper fall day."). `vsYesterday` compares to the same hour
yesterday on the feels-like scale. `dress` turns it into things to wear and bring.

## Ask the sky
Eight activities each have factors (comfort band on feels-like, dry, wind, daylight, air, storms, plus their own: wet slides after rain,
dew-point spread and sun for laundry, moon and cloud for stars). Score = 0.55 min + 0.45 mean, capped at 20 when any factor is
near zero, so one bad factor (thunder, dark) can't be averaged away. Pick one and the ribbon glows green where it is good;
the best window per day is the run of hours within 10 points of that day's peak. The weakest factor is the "why".

## Everyone
Saved places (up to 8, browser storage) appear as small skies with their current feel; tap to switch. One multi-point request.

## Data
Open-Meteo forecast (hourly, 15-minute precipitation, current; yesterday + 8 days), air quality, geocoding; NWS alerts (US);
Zippopotam/Nominatim for zip codes (borrowed from ClearSky, see its docs/spikes.md for the CORS results: no proxy needed).
Free tiers are for personal, non-commercial use.

## Borrowed from ClearSky
http with timeout/retry/typed errors, localStorage cache with stale fallback, zip lookup, time-zone helpers, NOAA sun position,
sunrise/sunset, build script, version label and self-update protocol, service worker, test and live-check conventions.
A link on the sun card opens the same spot in ClearSky for photo planning.

## Later
Native iOS when needed (same path as Media Studio's Clipper): keep core.js logic portable; a Home Screen widget showing the sky.
