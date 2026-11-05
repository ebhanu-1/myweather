# MyWeather

A weather app you **scrub through** instead of read. The whole screen is the sky. Drag it, or drag the week timeline, and the sky
(sun, moon, stars, clouds moving with the real wind, rain, snow, fog), the big "feels like" number, what to wear, and the
plan all change to that hour.

- **Feels like, in words:** "Chilly and breezy. The wind takes 6° off." Plus a one-line vibe and how it compares to yesterday.
- **Ask the sky:** tap Walk, Run, Playground, Bike, Grill, Laundry line, Stargazing or Pool day and the timeline lights up the best
  windows of the next 7 days. Tap a window to jump there.
- **What to wear and bring**, for the moment you are looking at.
- **Rain countdown** to the minute, and a sentence on what the next hours hold.
- **Everyone:** save the family's places and see each one's sky and feel at a glance.
- **Play the week:** watch four hours of weather per second.
- National Weather Service alerts for US places, sunset color forecast, moon phase, air quality.

No accounts, no API keys. Data comes straight from the browser (Open-Meteo, NWS, Zippopotam.us, OpenStreetMap Nominatim).
US units only for now.

## Use it
- **Anywhere:** https://ebhanu-1.github.io/myweather/ . On a phone, Share, Add to Home Screen. It updates itself.
- **Local:** `npm run serve`, open http://localhost:5174. Or open `index.html` (one self-contained file).

## Develop
```bash
npm test          # no network
npm run build     # writes index.html, bumps the version
npm run live      # hits the real APIs for five places
```
See CLAUDE.md for the architecture and release steps, docs/design.md for the design.
