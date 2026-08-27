// core-auth config: the active provider and harness settings, stored in
// config/auth.json (preferred) with a top-level fallback.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { configFolder, getConfigDir, CONFIG_SUBDIR } from "./env.js";
import { readModelCache } from "./models-cache.js";

function paths() {
  const dir = getConfigDir();
  return {
    preferred: join(dir, CONFIG_SUBDIR, "auth.json"),
    fallback: join(dir, "auth.json"),
  };
}

/** Reads core-auth's config, preferring `config/auth.json` over the top-level fallback; `{}` if neither exists or parses. */
export function readConfig(): Record<string, any> {
  const { preferred, fallback } = paths();
  const p = [preferred, fallback].find((c) => existsSync(c)) || null;
  try { return p ? JSON.parse(readFileSync(p, "utf8")) : {}; } catch { return {}; }
}

/** Writes core-auth's config to the preferred `config/auth.json` location; fails silently. */
export function writeConfig(cfg: Record<string, any>): void {
  const { preferred } = paths();
  try {
    if (!existsSync(configFolder())) mkdirSync(configFolder(), { recursive: true });
    writeFileSync(preferred, JSON.stringify(cfg, null, 2), "utf8");
  } catch {}
}

/** The currently selected provider id, or `""` if none is set. */
export function activeProvider(): string {
  return readConfig().provider || "";
}

/** Sets the currently selected provider id. */
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

// Sort source ids to filter out of a stale cache: a models.json written before a source
// was retired may still advertise it by id, which would incorrectly resurface it after
// an update. Filtering by id (rather than wiping the whole derived cache) still lets
// valid sources like "leaderboard" survive untouched until the next refresh. Add an id
// here when retiring a sort source.
const RETIRED_SOURCES = new Set<string>(["recommended"]);

interface StoredAutoConfig {
  order?: string[];
  excluded?: string[];
  source?: string;
}

/** Auto-sort sources available for a provider: always `"manual"`, plus whatever the model cache advertises, minus any retired ids. */
export function getAutoSources(providerId: string): Array<{ id: string; label: string }> {
  const cache = readModelCache(providerId);
  const extra = (cache && Array.isArray(cache.sorts) ? cache.sorts : [])
    .filter((s) => s && s.id && !RETIRED_SOURCES.has(s.id));
  return [{ id: "manual", label: "Manual" }, ...extra];
}

/**
 * A provider's Auto-model config, reconciled against the live catalog so new models append and
 * removed ones drop rather than the stored config going stale.
 */
export function getAutoConfig(providerId: string): {
  /** Ranked raw model ids, reconciled against the live catalog. */
  order: string[];
  /** Raw model ids excluded from Auto. */
  excluded: string[];
  /** The active sort source id, `"manual"` or one of `sources`. */
  source: string;
  /** Every sort source available for this provider, from `getAutoSources`. */
  sources: Array<{
    /** The source id. */
    id: string;
    /** Display label. */
    label: string;
  }>;
} {
  const stored: StoredAutoConfig = (readConfig().auto || {})[providerId] || {};
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

/** Stores a provider's Auto-model config; an omitted field keeps its previously stored value. */
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

/** The ranked, non-excluded raw model ids Auto should try, top preference first. */
export function getAutoCandidates(providerId: string): string[] {
  const { order, excluded } = getAutoConfig(providerId);
  const ex = new Set(excluded);
  return order.filter((id) => !ex.has(id));
}
