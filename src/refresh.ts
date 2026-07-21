// @ts-nocheck
// App-agnostic model refresh, shared by the opencode plugin startup, `oc auth login`,
// and the loader's in-tab account menu. Resolving the catalog (live fetch -> static ->
// cache) is host-neutral and auth-aware (a live fetch only runs when the provider has
// accounts); writing it into opencode.json happens ONLY under opencode (claude reads
// the model cache directly via claude-code-loader). Kept in its own module so the menu
// can trigger a refresh without importing opencode.ts (which would form an import cycle).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";
import { getConfigDir } from "./env.js";
import { log } from "./log.js";
import { listAccounts } from "./accounts.js";
import { resolveProviderModels, readModelCache, writeModelCache } from "./models-cache.js";
import { computeSorts } from "./sorts.js";

// The host is opencode unless the active config dir is the Claude home. The loader sets
// HUB_CONFIG_DIR to the app's config dir, so the path is the reliable signal.
export function isOpencodeHost(): boolean {
  const dir = getConfigDir().replace(/\\/g, "/").replace(/\/+$/, "");
  if (dir.endsWith("/.claude") || dir.endsWith("/claude")) return false;
  return dir.includes("opencode");
}

function opencodeConfigPath(): string {
  const override = (process.env.OPENCODE_CONFIG || "").trim();
  if (override) return resolve(override);
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const dir = join(base, "opencode");
  const jsonc = join(dir, "opencode.jsonc");
  const json = join(dir, "opencode.json");
  return existsSync(jsonc) ? jsonc : json;
}

function stripJsonc(text: string): string {
  return text
    .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (match, group) => (group ? "" : match))
    .replace(/,(\s*[}\]])/g, "$1");
}

export function mergeModels(opencodeProvider: string, models: Record<string, unknown>, npm?: string): void {
  const path = opencodeConfigPath();
  let config: Record<string, any> = {};
  try { if (existsSync(path)) config = JSON.parse(stripJsonc(readFileSync(path, "utf8"))); } catch {}
  if (!config.$schema) config.$schema = "https://opencode.ai/config.json";
  config.provider = config.provider || {};
  config.provider[opencodeProvider] = config.provider[opencodeProvider] || {};
  // a custom (non-built-in) provider needs an SDK to parse the response
  if (npm) {
    config.provider[opencodeProvider].npm = npm;
    // @ai-sdk providers (google/anthropic/…) validate a NON-EMPTY apiKey when the
    // model is constructed, before our loader's fetch override takes over, so
    // seed a dummy key. Real auth is the per-account OAuth token applied in handle().
    const existingOptions = config.provider[opencodeProvider].options || {};
    config.provider[opencodeProvider].options = {
      ...existingOptions,
      apiKey: existingOptions.apiKey || opencodeProvider,
    };
  }
  // REPLACE (not merge) the provider's models every refresh so a renamed/removed
  // model id can never linger as a stale entry; the provider owns this list.
  config.provider[opencodeProvider].models = { ...models };
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
  } catch (e) { log("opencode model merge failed: " + (e && e.message)); }
}

// Resolve the provider's catalog and persist it: always refresh the model cache (which
// enables the "Configure Auto models" menu and feeds claude-code-loader) and merge the
// models into opencode.json when running under opencode. Run at plugin startup and right
// after a login so a newly-authed account populates models without waiting for a restart.
//
// `forceOpencodeMerge` is set by the opencode integration (opencode.ts), which only ever
// runs inside the opencode process, where HUB_CONFIG_DIR may be unset and isOpencodeHost()
// would be unreliable, so the merge must be unconditional. The host-agnostic menu/login
// paths leave it false and rely on isOpencodeHost() (the loaders export HUB_CONFIG_DIR).
export async function refreshModels(def, forceOpencodeMerge = false): Promise<Record<string, unknown>> {
  let models: Record<string, unknown> = {};
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
    if (forceOpencodeMerge || isOpencodeHost()) mergeModels(def.opencodeProvider || "anthropic", models, def.opencodeNpm);
  } catch (e) { log("model refresh/merge failed: " + e); }
  return models;
}
