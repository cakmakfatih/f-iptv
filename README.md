# F-IPTV

A TV app for Xtream-compatible IPTV services, built on [zapkit-tv](https://github.com/cakmakfatih/zapkit-tv). It plays **your own** subscription: the app ships no channels, movies or series, you add your Xtream account. It runs in TV browsers (Tizen, webOS, VIDAA, Android TV) and desktop browsers, and is a PWA.

## Features

- **Profiles.** A profile picker opens first, like a streaming service: add up to 4 Xtream accounts, give each a name, edit or forget it. Every profile keeps its own continue-watching data. Changing only the name keeps that data; changing the server, username or password asks for confirmation and removes it.
- **Live TV** with a channel list, categories and a live preview, **Movies**, and **Series** with seasons, episodes and continue-watching.
- **Player** built on the zapkit-tv player: HLS and progressive streams, seek, subtitles, audio tracks, quality, previous/next channel, next episode with an "up next" card, back to live, aspect ratio.
- **Continue watching** per series and movie, shown on the home screen.
- **Two languages**, English and Turkish. The language follows the device and falls back to English; it can be changed at the top right of the profile picker.
- **Made for the remote:** everything is reachable with the D-pad, the on-screen keyboard wraps around at its edges, and the first focus is always on the first item of a screen.

## Run it

```bash
npm install
npm run dev          # development server on http://0.0.0.0:3000
npm run build        # type-check and build to dist/
npm run preview      # serve the production build on http://0.0.0.0:3000
```

The project expects zapkit-tv next to it (`../zapkit-tv`), see `vite.config.ts`. The build targets Chrome 69 so older TV browsers work; use the production build (`preview`) on a TV, the dev server is not transpiled for old engines.

Open `http://<computer-ip>:3000` in the TV browser.

## Installing as a PWA

The manifest, icons and service worker are included. Browsers only offer installation and register the service worker on a **secure context**: `https://` or `localhost`. Served over plain `http` on a LAN address (like `http://192.168.1.100:3000`) the app works as a normal web page. To install it, serve the `dist/` folder over HTTPS.

## Good to know

- The app talks to your Xtream server straight from the browser. The server (and the network the device is on) must be reachable from that device; if the TV uses a DNS service with filtering, allow your server's domain there.
- Channel logos come from many third-party sites. When the app is served with `npm run dev` or `npm run preview`, the server fetches them for the TV (`image-proxy.ts`: only public addresses and image responses are allowed). Served from somewhere else, the browser loads them directly.
- Passwords of saved profiles are stored in the browser's `localStorage` on the device.

## Project layout

| Path | Content |
|---|---|
| `src/screens` | Profiles, Login (add/edit), Home, Live, Movies, Series, SeriesDetail, Watch |
| `src/components` | Shared UI (`ui.tsx`), the player parts that belong to this app (`player-parts.tsx`), the language switch, icons, poster grid settings |
| `src/services` | Xtream client and profiles (`api.ts`), continue-watching store (`history.ts`), stream sources (`media.ts`), formatting |
| `src/i18n` | `t()`, language detection, `en.ts` (source of the keys) and `tr.ts` |
| `public` | Manifest, service worker and icons |
| `image-proxy.ts` | Vite plugin that fetches channel logos for the TV |

## Settings you may want to change

- **Poster columns:** `COLUMNS` in `src/components/grid.ts` (4 big cards or 6 smaller ones per row).
- **Profile limit:** `MAX_PROFILES` in `src/services/api.ts`.
- **Add a language:** add a table with the same keys as `en.ts`, register it in `src/i18n/index.ts`.

## License

Private project. The app plays content from the account its user enters; it does not provide or host any content.
