// @ts-nocheck
// Shared proxy pool, persisted to <configDir>/config/core-auth-proxies.json. One
// pool for all providers; accounts reference proxies from it.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { configFolder } from "../env.js";

const FILE = "core-auth-proxies.json";
function storeFile() { return join(configFolder(), FILE); }

function empty() {
  return { version: 2, modes: { default: "disabled" }, providers: {}, proxies: [], assignments: {}, manualSelection: {} };
}

// v1 -> v2: owner -> scope{account}, untagged -> scope{global}; single `mode` ->
// modes.default; manualSelection keyed by accountId -> "account:<id>". Idempotent.
export function migrateStore(raw) {
  if (!raw || typeof raw !== "object") return empty();
  if (raw.version === 2) return { ...empty(), ...raw, modes: { ...empty().modes, ...(raw.modes || {}) } };
  const out = empty();
  out.providers = raw.providers || {};
  out.assignments = raw.assignments || {};
  out.modes = { default: raw.mode || "disabled" };
  out.proxies = (raw.proxies || []).map((p) => ({
    url: p.url, provider: p.provider, addedAt: p.addedAt, stats: p.stats || {},
    scope: p.owner ? { type: "account", id: p.owner } : { type: "global" },
  }));
  out.manualSelection = {};
  for (const [accId, urls] of Object.entries(raw.manualSelection || {})) out.manualSelection["account:" + accId] = urls;
  return out;
}

export function loadProxyStore() {
  try { const f = storeFile(); if (existsSync(f)) return migrateStore(JSON.parse(readFileSync(f, "utf8")) || {}); } catch {}
  return empty();
}

export function saveProxyStore(store) {
  try {
    if (!existsSync(configFolder())) mkdirSync(configFolder(), { recursive: true });
    const file = storeFile();
    const tmp = file + "." + randomBytes(6).toString("hex") + ".tmp";
    writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, file);
  } catch {}
}

export function updateProxyStore(mutator) {
  const store = loadProxyStore();
  mutator(store);
  saveProxyStore(store);
  return store;
}
