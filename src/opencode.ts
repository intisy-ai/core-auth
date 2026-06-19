// @ts-nocheck
// OpenCode integration: merge the provider's models into opencode config and return the auth hook whose loader.fetch calls handle().

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";
import { getConfigDir } from "./env.js";
import { log } from "./log.js";
import { listAccounts } from "./accounts.js";
import { isTTY } from "./ui/ansi.js";
import { runProviderMenu } from "./menu.js";
import { resolveProviderModels, readModelCache, writeModelCache } from "./models-cache.js";
import { computeSorts } from "./sorts.js";

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

function mergeModels(opencodeProvider: string, models: Record<string, unknown>, npm?: string): void {
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
    // model is constructed — before our loader's fetch override takes over — so
    // seed a dummy key. Real auth is the per-account OAuth token applied in handle().
    const existingOptions = config.provider[opencodeProvider].options || {};
    config.provider[opencodeProvider].options = {
      ...existingOptions,
      apiKey: existingOptions.apiKey || opencodeProvider,
    };
  }
  // REPLACE (not merge) the provider's models every startup so a renamed/removed
  // model id can never linger as a stale entry — the provider owns this list.
  config.provider[opencodeProvider].models = { ...models };
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
  } catch (e) { log("opencode model merge failed: " + (e && e.message)); }
}

// Resolve the provider's catalog (live fetch -> cache -> empty) and write it into
// opencode config. Run at plugin startup and again right after a login so newly
// authed accounts populate the model list without waiting for the next start.
async function refreshAndMerge(def): Promise<void> {
  const opencodeProvider = def.opencodeProvider || "anthropic";
  try {
    const hasAccounts = listAccounts(def.id).length > 0;
    const models = await resolveProviderModels(def, { configDir: getConfigDir(), log, hasAccounts }, Date.now());
    mergeModels(opencodeProvider, models, def.opencodeNpm);
    // compute + cache the provider's available Auto sort sources (manual is implicit;
    // recommended is free with a ranking; leaderboard/custom are provider opt-ins).
    const cache = readModelCache(def.id);
    if (cache) {
      const { sorts, sortOrders } = await computeSorts(def, cache.ranking || []);
      writeModelCache(def.id, { ...cache, sorts, sortOrders });
    }
  } catch (e) { log("model refresh/merge failed: " + e); }
}

// `oc auth login` for a provider with an account controller (in a TTY) opens our
// interactive account-management TUI (runProviderMenu: list/add/remove/verify),
// where "Add account" runs the driver's own OAuth login (loopback listener +
// terminal paste fallback). Otherwise it falls back to opencode's `code` oauth
// method: opencode prompts for the pasted code / redirect URL and hands it to
// callback(code) — terminal-conflict-free for non-TTY / container-only flows.
function authMethods(def) {
  if (typeof def.loginFlow !== "function") {
    return [{ label: def.label + " (via core-auth)", type: "api" }];
  }
  return [{
    type: "oauth",
    label: def.label,
    authorize: async function () {
      if (def.accounts && isTTY()) {
        try { await runProviderMenu(def); } catch (e) { log("account menu failed: " + e); }
        await refreshAndMerge(def);   // pull the now-authed account's live model catalog
        return { url: "", instructions: def.label + " accounts updated.", method: "auto", callback: async () => ({ type: "success", refresh: "core-auth", access: "", expires: 0 }) };
      }
      const flow = await def.loginFlow({ configDir: getConfigDir(), log });
      return {
        url: flow.url,
        instructions: flow.instructions || ("Sign in to " + def.label + ", then paste the authorization code (or the full redirect URL) here."),
        method: "code",
        callback: async function (code) {
          try {
            const account = await flow.complete(code);
            if (!account || !account.refresh) return { type: "failed" };
            await refreshAndMerge(def);   // pull the now-authed account's live model catalog
            return { type: "success", refresh: account.refresh, access: account.access || "", expires: account.expires || 0 };
          } catch (error) { log("oauth login failed: " + error); return { type: "failed" }; }
        },
      };
    },
  }];
}

export function createOpencodePlugin(def) {
  const opencodeProvider = def.opencodeProvider || "anthropic";
  return async function (input) {
    await refreshAndMerge(def);
    // when accounts already exist, seed opencode's auth entry so it routes through our loader without the user running `oc auth login`
    try {
      const client = input && input.client;
      if (client && client.auth && listAccounts(def.id).length > 0) {
        await client.auth.set({ path: { id: opencodeProvider }, body: { type: "oauth", refresh: "", access: "", expires: 0 } });
      }
    } catch (e) { log("auto-route seed failed: " + e); }
    const hooks = {
      auth: {
        provider: opencodeProvider,
        methods: authMethods(def),
        loader: async function () {
          return {
            apiKey: def.id,
            fetch: function (req, init) {
              return def.handle(new Request(req, init), { configDir: getConfigDir(), log });
            },
          };
        },
      },
    };
    // A provider may contribute extra opencode hooks (e.g. an `event` handler for
    // session recovery). Generic passthrough — core doesn't know what they do.
    if (typeof def.opencodeHooks === "function") {
      try { Object.assign(hooks, (await def.opencodeHooks(input)) || {}); }
      catch (e) { log("opencodeHooks failed: " + e); }
    }
    return hooks;
  };
}
