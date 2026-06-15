// @ts-nocheck
// OpenCode integration: merge the provider's models into opencode config and
// return the auth hook whose loader.fetch calls handle(). The `api` method
// exists so a no-key `oc auth login` makes opencode route through our loader.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";
import { getConfigDir } from "./env.js";
import { log } from "./log.js";

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

// The auth methods opencode shows under `oc auth login`. When the driver provides
// a loginFlow, core owns the entire OAuth TUI: authorize() hands opencode the URL
// + instructions, callback() waits for the driver flow to finish and persists the
// account. Otherwise we fall back to a no-key api method (just makes opencode route
// through loader.fetch, using accounts already in the core store).
function authMethods(def) {
  if (typeof def.loginFlow !== "function") {
    return [{ label: def.label + " (via core-auth)", type: "api" }];
  }
  return [{
    type: "oauth",
    label: def.label,
    authorize: async function () {
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
  return async function () {
    try { mergeModels(opencodeProvider, def.models || {}, def.opencodeNpm); } catch {}
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
