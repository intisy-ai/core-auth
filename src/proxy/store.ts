// Shared proxy pool, persisted to <configDir>/config/core-auth-proxies.json. One
// pool for all providers; accounts reference proxies from it.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { configFolder } from "../env.js";
import type { ProxyProviderConfig } from "./providers.js";

export type ProxyScope = { type: "global" } | { type: "account"; id: string } | { type: "provider"; id: string };

export interface ProxyStats {
  checks?: number;
  failures?: number;
  avgLatencyMs?: number;
  ipRateLimitHits?: number;
  lastOkAt?: number;
  lastRateLimitAt?: number;
}

export interface ProxyEntry {
  url: string;
  provider: string;
  scope: ProxyScope;
  addedAt: number;
  stats: ProxyStats;
}

export interface ProxyStore {
  version: 2;
  modes: Record<string, string>;
  providers: Record<string, ProxyProviderConfig>;
  proxies: ProxyEntry[];
  assignments: Record<string, string>;
  manualSelection: Record<string, string[]>;
}

const FILE = "core-auth-proxies.json";
function storeFile(): string { return join(configFolder(), FILE); }

function empty(): ProxyStore {
  return { version: 2, modes: { default: "disabled" }, providers: {}, proxies: [], assignments: {}, manualSelection: {} };
}

// Whatever JSON.parse produced from the on-disk file, across every schema version this has ever
// shipped -- validated field by field below rather than trusted wholesale.
interface RawProxyStore {
  version?: number;
  mode?: string;                                        // v1 only
  modes?: Record<string, string>;                        // v2
  providers?: Record<string, ProxyProviderConfig>;
  proxies?: Array<{ url: string; provider: string; addedAt?: number; stats?: ProxyStats; owner?: string; scope?: ProxyScope }>;
  assignments?: Record<string, string>;
  manualSelection?: Record<string, string[]>;
}

// v1 -> v2: owner -> scope{account}, untagged -> scope{global}; single `mode` ->
// modes.default; manualSelection keyed by accountId -> "account:<id>". Idempotent.
export function migrateStore(raw: unknown): ProxyStore {
  if (!raw || typeof raw !== "object") return empty();
  const input = raw as RawProxyStore;
  if (input.version === 2) {
    return { ...empty(), ...input, modes: { ...empty().modes, ...(input.modes || {}) } } as ProxyStore;
  }
  const out = empty();
  out.providers = input.providers || {};
  out.assignments = input.assignments || {};
  out.modes = { default: input.mode || "disabled" };
  out.proxies = (input.proxies || []).map((p) => ({
    url: p.url, provider: p.provider, addedAt: p.addedAt ?? 0, stats: p.stats || {},
    scope: p.owner ? { type: "account" as const, id: p.owner } : { type: "global" as const },
  }));
  out.manualSelection = {};
  for (const [accId, urls] of Object.entries(input.manualSelection || {})) out.manualSelection["account:" + accId] = urls;
  return out;
}

export function loadProxyStore(): ProxyStore {
  try { const f = storeFile(); if (existsSync(f)) return migrateStore(JSON.parse(readFileSync(f, "utf8")) || {}); } catch {}
  return empty();
}

export function saveProxyStore(store: ProxyStore): void {
  try {
    if (!existsSync(configFolder())) mkdirSync(configFolder(), { recursive: true });
    const file = storeFile();
    const tmp = file + "." + randomBytes(6).toString("hex") + ".tmp";
    writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, file);
  } catch {}
}

export function updateProxyStore(mutator: (store: ProxyStore) => void): ProxyStore {
  const store = loadProxyStore();
  mutator(store);
  saveProxyStore(store);
  return store;
}
