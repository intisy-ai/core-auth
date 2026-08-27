// App-agnostic model refresh, shared by the provider plugin startup, `oc auth login`,
// and the loader's in-tab account menu. Resolving the catalog (live fetch -> static ->
// cache) is host-neutral and auth-aware (a live fetch only runs when the provider has
// accounts); writing it into the app's own config file happens ONLY for an app that
// declares a `modelCatalog`. Kept in its own module so the menu chain (menu.ts ->
// menu-model.ts -> url-auth.ts) can trigger a refresh without importing
// provider-plugin-runtime.ts, which imports that same chain to wire runProviderMenu
// (an import cycle).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { getConfigDir } from "./env.js";
import { activeDescriptor, expandPath, resolveHome } from "./app-registry.js";
import { log } from "./log.js";
import { listAccounts } from "./accounts.js";
import { resolveProviderModels, readModelCache, writeModelCache } from "./models-cache.js";
import { computeSorts } from "./sorts.js";
import { emitActivity } from "./activity.js";
import type { ProviderDef } from "./types.js";

/** Whether the active app declares a config file this library merges a model catalog into. */
export function mergesModelCatalog(): boolean {
  return !!activeDescriptor()?.modelCatalog;
}

// The declared file: the app's own env override wins outright, then the first declared candidate
// that exists, then the LAST declared candidate. Earlier entries are preferred only when they
// already exist, so a first refresh into a fresh home creates the last (plain) file rather than a
// commented variant an earlier entry names.
function catalogPath(): string {
  const desc = activeDescriptor();
  const declared = desc?.modelCatalog;
  if (!desc || !declared || !declared.files.length) return "";
  const override = (declared.envOverride ? process.env[declared.envOverride] || "" : "").trim();
  if (override) return resolve(override);
  const home = getConfigDir() || resolveHome(desc);
  const candidates = declared.files.map((file) => expandPath(file, home));
  return candidates.find((candidate) => existsSync(candidate)) || candidates[candidates.length - 1];
}

function stripJsonc(text: string): string {
  return text
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (match, group) => (group ? "" : match))
    .replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Merges a provider's models into the active app's own config file, keyed under its declared
 * provider key.
 *
 * @remarks A no-op when the active app declares no `modelCatalog`. REPLACES (not merges) the provider's whole model list on every call, so a renamed or removed model id can never linger as a stale entry.
 */
export function mergeModels(providerId: string, models: Record<string, unknown>, npm?: string): void {
  const declared = activeDescriptor()?.modelCatalog;
  const path = catalogPath();
  if (!declared || !path) return;
  let config: Record<string, any> = {};
  try { if (existsSync(path)) config = JSON.parse(stripJsonc(readFileSync(path, "utf8"))); } catch {}
  if (!config.$schema && declared.schemaUrl) config.$schema = declared.schemaUrl;
  const providers = config[declared.providerKey] = config[declared.providerKey] || {};
  providers[providerId] = providers[providerId] || {};
  // a custom (non-built-in) provider needs an SDK to parse the response
  if (npm) {
    providers[providerId].npm = npm;
    // @ai-sdk providers (google/anthropic/…) validate a NON-EMPTY apiKey when the
    // model is constructed, before our loader's fetch override takes over, so
    // seed a dummy key. Real auth is the per-account OAuth token applied in handle().
    const existingOptions = providers[providerId].options || {};
    providers[providerId].options = {
      ...existingOptions,
      apiKey: existingOptions.apiKey || providerId,
    };
  }
  // REPLACE (not merge) the provider's models every refresh so a renamed/removed
  // model id can never linger as a stale entry; the provider owns this list.
  providers[providerId].models = { ...models };
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
  } catch (e) { log("model catalog merge failed: " + (e instanceof Error ? e.message : String(e))); }
}

/**
 * Resolves a provider's model catalog and persists it: always refreshes the model cache, and
 * merges the models into the app's own config when the active app declares one.
 *
 * @remarks Run at plugin startup and right after a login, so a newly-authed account populates models without waiting for a restart. Fails silently, logging the error.
 * @returns the resolved models, or `{}` on failure
 */
export async function refreshModels(def: ProviderDef): Promise<Record<string, unknown>> {
  let models: Record<string, unknown> = {};
  const startedAt = Date.now();
  try {
    const hasAccounts = listAccounts(def.id).length > 0;
    models = await resolveProviderModels(def, { configDir: getConfigDir(), log, hasAccounts }, Date.now());
    // compute + cache the provider's Auto sort sources (leaderboard/custom). The
    // leaderboard ranks by DISPLAY NAME, so pass id->name from the catalog (the raw
    // catalog id is opaque and carries neither the model name nor the effort marker).
    const cache = readModelCache(def.id);
    if (cache) {
      const catalogModels = (cache.models || models || {}) as Record<string, { name?: string }>;
      const nameOf = (id: string) => (catalogModels[id] && catalogModels[id].name) || id;
      const { sorts, sortOrders, scores, scoreSource } = await computeSorts(def, cache.ranking || [], nameOf);
      writeModelCache(def.id, { ...cache, sorts, sortOrders, scores, scoreSource });
    }
    if (mergesModelCatalog()) mergeModels(def.appProviderId || def.id, models, def.appNpm);
    emitActivity({ topic: "account", action: "models_refreshed", impact: "info", outcome: "ok", durationMs: Date.now() - startedAt, subject: { kind: "provider", id: def.id, label: def.id }, details: { provider: def.id, count: Object.keys(models).length } }, def.id);
  } catch (e) { log("model refresh/merge failed: " + e); }
  return models;
}
