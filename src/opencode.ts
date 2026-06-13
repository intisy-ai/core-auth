// @ts-nocheck
// OpenCode integration for a provider. On plugin load it merges the provider's
// models into the active opencode config, then returns an @opencode-ai/plugin
// auth hook whose loader supplies a fetch that calls the provider's handle().
// OpenCode routes a provider through that fetch once an auth entry exists, so an
// `api` auth method is registered for a no-key `oc auth login`. No proxy/baseURL.

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

function mergeModels(opencodeProvider: string, models: Record<string, unknown>): void {
  const path = opencodeConfigPath();
  let config: Record<string, any> = {};
  try { if (existsSync(path)) config = JSON.parse(stripJsonc(readFileSync(path, "utf8"))); } catch {}
  if (!config.$schema) config.$schema = "https://opencode.ai/config.json";
  config.provider = config.provider || {};
  config.provider[opencodeProvider] = config.provider[opencodeProvider] || {};
  const existing = config.provider[opencodeProvider].models || {};
  config.provider[opencodeProvider].models = { ...existing, ...models };
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
  } catch (e) { log("opencode model merge failed: " + (e && e.message)); }
}

export function createOpencodePlugin(def) {
  const opencodeProvider = def.opencodeProvider || "anthropic";
  return async function () {
    try { mergeModels(opencodeProvider, def.models || {}); } catch {}
    return {
      auth: {
        provider: opencodeProvider,
        methods: [{ label: def.label + " (via core-auth)", type: "api" }],
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
