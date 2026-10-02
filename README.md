# Whatnot Show Control

A local broadcast automation and graphics system for Whatnot live shows. A read-only Chrome extension watches the show page, a local server keeps the show's memory, and OBS browser graphics turn sales, records, milestones and leaderboards into production moments.

- **Architecture, risks, event schema and roadmap:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Phase 1 probe (current):** [`extension/README.md`](extension/README.md)

```
npm test       # unit tests (Node 20+, no dependencies)
npm run mock   # offline mock Whatnot show at http://localhost:5179/mock/
```

| Phase | Status |
|---|---|
| 1 DOM probe | Built, needs verification on real shows |
| 2 Local server + dashboard | Designed |
| 3 Basic OBS SOLD | Designed |
| 4 Show memory | Designed |
| 5 Graphics package | — |
| 6 NVIDIA depth | — |
| 7 Companion | — |
