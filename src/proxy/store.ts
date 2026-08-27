// Shared proxy pool, persisted to <configDir>/config/core-auth-proxies.json. One
// pool for all providers; accounts reference proxies from it.

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { randomBytes } from "crypto";
import { configFolder } from "../env.js";
import type { ProxyProviderConfig } from "./providers.js";

/** Which pool a proxy belongs to: every account/provider, one account, or one provider. */
export type ProxyScope =
  | {
      /** Every account and provider. */
      type: "global";
    }
  | {
      /** Just one account. */
      type: "account";
      /** The account id. */
      id: string;
    }
  | {
      /** Just one provider. */
      type: "provider";
      /** The provider id. */
      id: string;
    };

/** Health and usage counters for one {@link ProxyEntry}, absent members meaning "never recorded". */
export interface ProxyStats {
  /** Total health checks performed. */
  checks?: number;
  /** Total failed checks. */
  failures?: number;
  /** Rolling average latency, in milliseconds. */
  avgLatencyMs?: number;
  /** Total IP-suspected rate limits. */
  ipRateLimitHits?: number;
  /** Epoch ms of the last successful check. */
  lastOkAt?: number;
  /** Epoch ms of the last IP-suspected rate limit. */
  lastRateLimitAt?: number;
}

/** One proxy in the shared pool. */
export interface ProxyEntry {
  /** The proxy's URL, e.g. `http://host:port`. */
  url: string;
  /** The proxy-list source this entry came from, or `"manual"`. */
  provider: string;
  /** Which pool this proxy belongs to. */
  scope: ProxyScope;
  /** Epoch ms the proxy was added. Absent on an entry migrated from a v1 store that never recorded it. */
  addedAt?: number;
  /** Health and usage counters. */
  stats: ProxyStats;
}

/** The whole shared proxy pool, persisted to `<configDir>/config/core-auth-proxies.json`; one pool for all providers. */
export interface ProxyStore {
  /** The current store schema version. */
  version: 2;
  /** Proxy mode per scope key (e.g. `"default"`, `"account:<id>"`); see `scopes.ts`. */
  modes: Record<string, string>;
  /** Per-source config for every proxy-list source. */
  providers: Record<string, ProxyProviderConfig>;
  /** Every proxy in the pool. */
  proxies: ProxyEntry[];
  /** Which proxy URL is currently assigned per scope key. */
  assignments: Record<string, string>;
  /** User-picked candidate proxy URLs per scope key, for scopes not left to automatic selection. */
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

/**
 * Normalizes whatever JSON.parse produced from the on-disk store, across every schema version
 * this has ever shipped, into the current {@link ProxyStore} shape. Idempotent: a v2 store passes
 * through unchanged, and v1 is migrated (`owner` to `scope.account`, untagged to `scope.global`,
 * the single `mode` to `modes.default`, `manualSelection` rekeyed from an account id to
 * `"account:<id>"`).
 */
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
    url: p.url, provider: p.provider, addedAt: p.addedAt, stats: p.stats || {},
    scope: p.owner ? { type: "account" as const, id: p.owner } : { type: "global" as const },
  }));
  out.manualSelection = {};
  for (const [accId, urls] of Object.entries(input.manualSelection || {})) out.manualSelection["account:" + accId] = urls;
  return out;
}

/** Reads the shared proxy store, migrating it to the current schema; an empty store if the file is absent or unreadable. */
export function loadProxyStore(): ProxyStore {
  try { const f = storeFile(); if (existsSync(f)) return migrateStore(JSON.parse(readFileSync(f, "utf8")) || {}); } catch {}
  return empty();
}

/** Overwrites the shared proxy store, writing to a temp file and renaming it into place so a reader never sees a torn write; fails silently. */
export function saveProxyStore(store: ProxyStore): void {
  try {
    if (!existsSync(configFolder())) mkdirSync(configFolder(), { recursive: true });
    const file = storeFile();
    const tmp = file + "." + randomBytes(6).toString("hex") + ".tmp";
    writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, file);
  } catch {}
}

/** Read-modify-write on the shared proxy store: `mutator` mutates the freshly-read store in place. */
export function updateProxyStore(mutator: (store: ProxyStore) => void): ProxyStore {
  const store = loadProxyStore();
  mutator(store);
  saveProxyStore(store);
  return store;
}
