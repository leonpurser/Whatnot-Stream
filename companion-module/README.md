# Companion module: Whatnot Show Control

Ready to install: see `release/`, and [`../docs/SHOW-DAY.md`](../docs/SHOW-DAY.md) for the steps.

Development:
```
npm install
npm test          # runs the real module code against a real Show Control server (Companion is faked)
npm run package   # builds whatnot-show-control-<version>.tgz; copy it into release/
```

Built on `@companion-module/base` 1.11 so it works on Companion 3.5 and every later version (4.x, 5.x).
