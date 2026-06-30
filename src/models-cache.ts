// @ts-nocheck
// Shared model-catalog cache. core-auth fetches a provider's live models (via
// def.fetchModels) and writes them here; both the OpenCode merge and the Claude
// loader's Providers tab read this file instead of a hardcoded list.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { configFolder } from "./env.js";
import { log } from "./log.js";

const MODELS_FILE = "core-auth-models.json";

function cachePath() {
  return join(configFolder(), MODELS_FILE);
}

function readAll() {
  try {
    if (existsSync(cachePath())) return JSON.parse(readFileSync(cachePath(), "utf8")) || {};
  } catch {}
  return {};
}

// returns { models, ranking, defaultModelId, fetchedAt } | null
export function readModelCache(providerId) {
  const entry = readAll()[providerId];
  return entry && entry.models ? entry : null;
}

export function writeModelCache(providerId, entry) {
  try {
    const all = readAll();
    all[providerId] = { ...entry, fetchedAt: entry.fetchedAt || 0 };
    const dir = configFolder();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(all, null, 2), "utf8");
  } catch (e) {
    log("model cache write failed: " + (e && e.message));
  }
}

// Resolve a provider's catalog: live fetch when supported + an account exists,
// caching the result; otherwise the last cached catalog; otherwise empty
// (models stay empty until the first `oc auth login`). `nowMs` is injected so
// callers can stamp fetchedAt without this module touching Date.now directly.
export async function resolveProviderModels(def, ctx, nowMs) {
  const providerId = def.id;
  let catalog = null;   // { models, ranking, defaultModelId }

  // 1. live fetch — providers that implement fetchModels and have an account
  if (typeof def.fetchModels === "function" && ctx && ctx.hasAccounts) {
    try {
      const result = await def.fetchModels(ctx);
      if (result && result.models && Object.keys(result.models).length > 0) {
        catalog = { models: result.models, ranking: result.ranking || Object.keys(result.models), defaultModelId: result.defaultModelId };
      }
    } catch (e) {
      log("fetchModels failed for " + providerId + ": " + e);
    }
  }
  // 2. static catalog — providers that ship def.models (no fetch). ranking defaults
  //    to declaration order (the manual/catalog order; also the leaderboard input).
  if (!catalog && def.models && Object.keys(def.models).length > 0) {
    catalog = { models: def.models, ranking: Object.keys(def.models) };
  }
  // 3. last good cache; else empty (a fetch-only provider before first login)
  if (!catalog) {
    const cached = readModelCache(providerId);
    return cached ? cached.models : {};
  }

  // preserve any previously computed sort metadata; refreshModels updates it.
  const prev = readModelCache(providerId) || {};
  writeModelCache(providerId, {
    models: catalog.models,
    ranking: catalog.ranking,
    defaultModelId: catalog.defaultModelId,
    sorts: prev.sorts || [],
    sortOrders: prev.sortOrders || {},
    fetchedAt: nowMs || 0,
  });
  return catalog.models;
}
