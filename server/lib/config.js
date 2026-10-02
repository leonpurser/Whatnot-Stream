// Config = config/default.json  <  config/local.json (yours, optional)  <  data/settings.json (dashboard toggles)

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_FILE = path.join(ROOT, 'config', 'default.json');
const LOCAL_FILE = path.join(ROOT, 'config', 'local.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[config] could not read ${file}: ${e.message}`);
    return {};
  }
}

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function getPath(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, p, value) {
  const keys = p.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isObj(o[k])) o[k] = {};
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
}

class Config {
  constructor(dataDir) {
    this.settingsFile = path.join(dataDir, 'settings.json');
    this.reload();
  }

  reload() {
    this.base = deepMerge(readJson(DEFAULT_FILE), readJson(LOCAL_FILE));
    this.settings = readJson(this.settingsFile);
    this.value = deepMerge(this.base, this.settings);
  }

  get(p) {
    return p ? getPath(this.value, p) : this.value;
  }

  // Only existing boolean/number settings can be changed from the dashboard.
  set(p, value) {
    const current = getPath(this.base, p);
    if (typeof current !== 'boolean' && typeof current !== 'number') throw new Error(`setting ${p} is not editable`);
    if (typeof value !== typeof current) throw new Error(`setting ${p} must be a ${typeof current}`);
    setPath(this.settings, p, value);
    fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
    this.value = deepMerge(this.base, this.settings);
  }
}

module.exports = { Config, deepMerge, ROOT };
