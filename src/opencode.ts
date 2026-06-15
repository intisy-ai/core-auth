// @ts-nocheck
// OpenCode integration: merge the provider's models into opencode config and return the auth hook whose loader.fetch calls handle().

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";
import { getConfigDir } from "./env.js";
import { log } from "./log.js";
import { listAccounts } from "./accounts.js";
import { isTTY } from "./ui/ansi.js";
import { runAccountMenu } from "./ui/account-menu.js";

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
  if (npm) config.provider[opencodeProvider].npm = npm;
  const existing = config.provider[opencodeProvider].models || {};
  config.provider[opencodeProvider].models = { ...existing, ...models };
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
  } catch (e) { log("opencode model merge failed: " + (e && e.message)); }
}

// With a driver loginFlow, core owns the OAuth TUI; otherwise the no-key api method just makes opencode route through loader.fetch using existing accounts.
function authMethods(def) {
  if (typeof def.loginFlow !== "function") {
    return [{ label: def.label + " (via core-auth)", type: "api" }];
  }
  return [{
    type: "oauth",
    label: def.label,
    authorize: async function () {
      // TTY with a controller: run the interactive account-management menu (add does OAuth);
      // afterwards return a success so opencode routes through our loader (real accounts live in the core store).
      if (def.accounts && isTTY()) {
        const actions = [];
        if (def.models && Object.keys(def.models).length) {
          actions.push({ label: "Add " + def.label + " models to opencode config", run: () => { try { mergeModels(opencodeProvider, def.models, def.opencodeNpm); } catch {} } });
        }
        if (typeof def.accounts.actions === "function") actions.push(...def.accounts.actions());
        try { await runAccountMenu(def.accounts, { label: def.label, actions }); } catch (e) { log("account menu failed: " + e); }
        return { url: "", instructions: def.label + " accounts updated.", method: "auto", callback: async () => ({ type: "success", refresh: "core-auth", access: "", expires: 0 }) };
      }
      const flow = await def.loginFlow({ configDir: getConfigDir(), log });
      return {
        url: flow.url,
        instructions: flow.instructions || ("Sign in to " + def.label + ", then return to your terminal."),
        method: "auto",
        callback: async function () {
          try {
            const account = await flow.complete();
            if (!account || !account.refresh) return { type: "failed" };
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
    try { mergeModels(opencodeProvider, def.models || {}, def.opencodeNpm); } catch {}
    // driver load-time prep (e.g. legacy migration) must run before the account check below reflects the real pool
    try { if (typeof def.onLoad === "function") await def.onLoad({ configDir: getConfigDir(), log }); } catch (e) { log("onLoad failed: " + e); }
    // when accounts already exist, seed opencode's auth entry so it routes through our loader without the user running `oc auth login`
    try {
      const client = input && input.client;
      if (client && client.auth && listAccounts(def.id).length > 0) {
        await client.auth.set({ path: { id: opencodeProvider }, body: { type: "oauth", refresh: "", access: "", expires: 0 } });
      }
    } catch (e) { log("auto-route seed failed: " + e); }
    return {
      auth: {
        provider: opencodeProvider,
        methods: authMethods(def),
        loader: async function () {
          return {
            apiKey: def.id,
            fetch: function (input, init) {
              return def.handle(new Request(input, init), { configDir: getConfigDir(), log });
            },
          };
        },
      },
    };
  };
}
