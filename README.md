# Whatnot Show Control

A local broadcast automation and graphics system for Whatnot live shows. A read-only Chrome extension watches the show page, a local server keeps the show's memory, and an OBS browser overlay turns sales, records, milestones and leaderboards into production moments. You always keep manual control from the dashboard or Stream Deck.

**Start here: [`docs/SHOW-DAY.md`](docs/SHOW-DAY.md)** covers setup, rehearsal, show-day checklist and Companion buttons.

| | |
|---|---|
| Start the server | double-click `start-show-control.bat` (Windows) or run `npm start` |
| Dashboard | http://127.0.0.1:3000/dashboard/ |
| OBS overlay | http://127.0.0.1:3000/overlay/ (Browser Source 1080×1920) |
| Graphics demo | http://127.0.0.1:3000/overlay/?demo=1 |
| Chrome extension | load `extension/` unpacked (see [`extension/README.md`](extension/README.md)) |
| Design and event schema | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |

```
npm start      # server (Node 20+, no dependencies)
npm test       # unit + server tests
npm run mock   # offline mock Whatnot show at http://localhost:5179/mock/ (use with REHEARSAL mode)
```

| Phase | Status |
|---|---|
| 1 DOM probe | Built; seen working on a real show; price is a text guess until verified |
| 2 Local server + dashboard | Built |
| 3 OBS SOLD | Built |
| 4 Show memory (buyers, records, milestones) | Built |
| 5 Graphics package | First version (all graphics from the brief) |
| 6 NVIDIA depth | Not started |
| 7 Companion | HTTP API built; buttons listed in SHOW-DAY.md |
