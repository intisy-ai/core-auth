// Shared model-catalog cache. core-auth fetches a provider's live models (via
// def.fetchModels) and writes them here; both the app-config merge and the
// loader's Providers tab read this file instead of a hardcoded list.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { configFolder } from "./env.js";
import { log } from "./log.js";
import type { ProviderDef, ProviderModel } from "./types.js";

const MODELS_FILE = "models.json";

/** The context {@link ProviderDef.fetchModels} is called with, derived from its own declaration. */
export type ModelFetchCtx = Parameters<NonNullable<ProviderDef["fetchModels"]>>[0];

/** What {@link ProviderDef.fetchModels} resolves, derived from its own declaration. */
export type ModelFetchResult = Awaited<ReturnType<NonNullable<ProviderDef["fetchModels"]>>>;

export interface ModelCacheEntry {
  models: Record<string, ProviderModel>;
  ranking?: string[];
  defaultModelId?: string;
  fetchedAt?: number;
  source?: string;
  sorts?: Array<{ id: string; label: string }>;
  sortOrders?: Record<string, string[]>;
  scores?: Record<string, number>;
  scoreSource?: string;
}

function cachePath(): string {
  return join(configFolder(), MODELS_FILE);
}

function readAll(): Record<string, ModelCacheEntry> {
  try {
    if (existsSync(cachePath())) return JSON.parse(readFileSync(cachePath(), "utf8")) || {};
  } catch {}
  return {};
}

// NOTE: derived fields (sorts/sortOrders) are returned AS CACHED; we do NOT wipe them
// on read. Wiping would hide still-valid sources (e.g. leaderboard) until the next
// refresh. Stale RETIRED sources are filtered surgically in config.getAutoSources by id.
export function readModelCache(providerId: string): ModelCacheEntry | null {
  const entry = readAll()[providerId];
  return entry && entry.models ? entry : null;
}

export function writeModelCache(providerId: string, entry: ModelCacheEntry): void {
  try {
    const all = readAll();
    all[providerId] = { ...entry, fetchedAt: entry.fetchedAt || 0 };
    const dir = configFolder();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(all, null, 2), "utf8");
  } catch (e) {
    log("model cache write failed: " + (e instanceof Error ? e.message : String(e)));
  }
}

// Resolve a provider's catalog: live fetch when supported + an account exists,
// caching the result; otherwise the last cached catalog; otherwise empty
// (models stay empty until the first `oc auth login`). `nowMs` is injected so
// callers can stamp fetchedAt without this module touching Date.now directly.
export async function resolveProviderModels(
  def: ProviderDef,
  ctx: ModelFetchCtx,
  nowMs: number,
): Promise<Record<string, ProviderModel>> {
  const providerId = def.id;
  let catalog: ModelFetchResult | null = null;
  let source: string | null = null;

  // 1. live fetch: providers that implement fetchModels and have an account
  if (typeof def.fetchModels === "function" && ctx && ctx.hasAccounts) {
    try {
      const result = await def.fetchModels(ctx);
      if (result && result.models && Object.keys(result.models).length > 0) {
        catalog = { models: result.models, ranking: result.ranking || Object.keys(result.models), defaultModelId: result.defaultModelId };
        source = "live";
      }
    } catch (e) {
      log("fetchModels failed for " + providerId + ": " + e);
    }
  }
  // 2. static catalog: providers that ship def.models (no fetch). ranking defaults
  //    to declaration order (the manual/catalog order; also the leaderboard input).
  if (!catalog && def.models && Object.keys(def.models).length > 0) {
    catalog = { models: def.models, ranking: Object.keys(def.models) };
    source = "static";
  }
  // 3. last good cache; else empty (a fetch-only provider before first login)
  if (!catalog) {
    const cached = readModelCache(providerId);
    return cached ? cached.models : {};
  }

  // Generic "Auto" model: any multi-model provider automatically gets one; it resolves
  // at request time to the top of its Auto ranking (the provider's request handler does
  // the rewrite via getAutoCandidates). Skip if the provider already defines its own Auto
  // (antigravity keeps its thinking-level variants), or if there's nothing to choose from
  // (single-model providers like stub). NOT added to `ranking`, so Auto never resolves to
  // itself.
  const autoId = providerId + "-auto";
  if (!catalog.models[autoId] && (catalog.ranking || []).length > 1) {
    catalog.models = { [autoId]: { name: "Auto" }, ...catalog.models };
  }

  // preserve any previously computed sort metadata; refreshModels updates it.
  const prev = readModelCache(providerId);
  writeModelCache(providerId, {
    models: catalog.models,
    ranking: catalog.ranking,
    defaultModelId: catalog.defaultModelId,
    source: source || prev?.source || "static",   // live vs static-fallback, for the UI badge
    sorts: prev?.sorts || [],
    sortOrders: prev?.sortOrders || {},
    scores: prev?.scores || {},
    scoreSource: prev?.scoreSource || "",
    fetchedAt: nowMs || 0,
  });
  return catalog.models;
}
