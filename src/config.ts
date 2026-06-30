// @ts-nocheck
// core-auth config: the active provider and harness settings, stored in
// config/auth.json (preferred) with a top-level fallback. (Renamed from the old
// core-auth.json — read as a legacy fallback so existing configs keep working.)

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { configFolder, getConfigDir } from "./env.js";
import { readModelCache } from "./models-cache.js";

function paths() {
  const dir = getConfigDir();
  return {
    preferred: join(dir, "config", "auth.json"),
    fallback: join(dir, "auth.json"),
    legacy: [join(dir, "config", "core-auth.json"), join(dir, "core-auth.json")],
  };
}

export function readConfig(): Record<string, any> {
  const { preferred, fallback, legacy } = paths();
  const p = [preferred, fallback, ...legacy].find((c) => existsSync(c)) || null;
  try { return p ? JSON.parse(readFileSync(p, "utf8")) : {}; } catch { return {}; }
}

export function writeConfig(cfg: Record<string, any>): void {
  const { preferred } = paths();
  try {
    if (!existsSync(configFolder())) mkdirSync(configFolder(), { recursive: true });
    writeFileSync(preferred, JSON.stringify(cfg, null, 2), "utf8");
  } catch {}
}

export function activeProvider(): string {
  return readConfig().provider || "";
}

export function setActiveProvider(name: string): void {
  const cfg = readConfig();
  cfg.provider = name;
  writeConfig(cfg);
}

// --- Auto model ranking/inclusion (the "Auto" meta-model's config) ---
// Stored under cfg.auto[providerId] = { order: [rawId...], excluded: [rawId...] }.
// Always reconciled against the live catalog: new models append, removed ones drop,
// so the config never goes stale relative to what the account actually offers.

// "manual" is always available (the user's hand-ordered list). Every other source
// (recommended, leaderboard, custom) is provider-defined and advertised in the
// model cache as { id, label } with a precomputed order in sortOrders.

// Sort source ids that USED to exist but were removed from the code. A cache written
// by older code may still advertise them; filter them out by id so a retired source can
// never keep surfacing from a stale core-auth-models.json after an update — WITHOUT
// wiping the whole derived cache (which would also hide still-valid sources like
// "leaderboard" until the next refresh). When you retire a sort source, add its id here.
const RETIRED_SOURCES = new Set<string>(["recommended"]);

// Available sources for a provider: always manual, plus whatever the cache advertises
// (minus any retired ids).
export function getAutoSources(providerId: string): Array<{ id: string; label: string }> {
  const cache = readModelCache(providerId);
  const extra = (cache && Array.isArray(cache.sorts) ? cache.sorts : [])
    .filter((s) => s && s.id && !RETIRED_SOURCES.has(s.id));
  return [{ id: "manual", label: "Manual" }, ...extra];
}

export function getAutoConfig(providerId: string): {
  order: string[]; excluded: string[]; source: string; sources: Array<{ id: string; label: string }>;
} {
  const stored = (readConfig().auto || {})[providerId] || {};
  const cache = readModelCache(providerId);
  const catalogOrder: string[] = (cache && cache.ranking) || [];
  const sortOrders: Record<string, string[]> = (cache && cache.sortOrders) || {};
  const reconcile = (ids: string[]) => {
    const out = (Array.isArray(ids) ? ids : []).filter((id) => catalogOrder.includes(id));
    for (const id of catalogOrder) if (!out.includes(id)) out.push(id);
    return out;
  };

  const sources = getAutoSources(providerId);
  const validIds = sources.map((s) => s.id);
  // Default to the live "leaderboard" quality sort when the provider offers it, else
  // fall back to manual. A stored choice always wins (if still valid).
  const fallbackSource = validIds.includes("leaderboard") ? "leaderboard" : "manual";
  const source = stored.source && validIds.includes(stored.source) ? stored.source : fallbackSource;

  // manual = the stored hand-ordered list; any other source = its precomputed order
  const order = source === "manual"
    ? reconcile(stored.order && stored.order.length ? stored.order : catalogOrder)
    : reconcile(sortOrders[source] || catalogOrder);

  const excluded = (Array.isArray(stored.excluded) ? stored.excluded : []).filter((id) => catalogOrder.includes(id));
  return { order, excluded, source, sources };
}

export function setAutoConfig(
  providerId: string,
  auto: { order?: string[]; excluded?: string[]; source?: string },
): void {
  const cfg = readConfig();
  cfg.auto = cfg.auto || {};
  const prev = cfg.auto[providerId] || {};
  cfg.auto[providerId] = {
    order: auto.order !== undefined ? auto.order : prev.order || [],
    excluded: auto.excluded !== undefined ? auto.excluded : prev.excluded || [],
    source: auto.source !== undefined ? auto.source : prev.source || "manual",
  };
  writeConfig(cfg);
}

// The ranked, included raw model ids Auto should try (top preference first).
export function getAutoCandidates(providerId: string): string[] {
  const { order, excluded } = getAutoConfig(providerId);
  const ex = new Set(excluded);
  return order.filter((id) => !ex.has(id));
}
