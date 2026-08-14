// @ts-nocheck
// Filesystem locations, derived from the active app's config dir. Resolution mirrors
// core's getAppConfigDir so the two libs AGREE: HUB_CONFIG_DIR (the loader's forced
// dir, reliable even headless under the proxy) → the app's OWN native var
// (CLAUDE_CONFIG_DIR / OPENCODE_CONFIG_DIR|XDG_CONFIG_HOME) → fs fallback.
// (core-auth is standalone and doesn't bundle core, so the logic is mirrored, not imported.)

import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// The config subdirectory's name, mirrored from core the same way the home
// resolution above is: an app declares it in the registry, core's appPaths
// resolves it, and whoever bundles core passes the result down here. Only a
// single path segment is accepted, so a name cannot move storage out of the home.
export const CONFIG_SUBDIR = (function () {
  const declared = (process.env.HUB_CONFIG_SUBDIR || "").trim();
  if (!declared || declared === "." || declared === ".." || /[\\/]/.test(declared)) return "config";
  return declared;
})();

// The single core-auth app-home resolver. core-auth has no `core` submodule of its
// own (only provider repos nest core-auth and core side by side), so it cannot import
// core's app-detection primitive; every other core-auth module that needs to know
// which app it's running under (e.g. notify.ts) MUST import this instead of
// re-deriving its own process.argv/env check.
export function activeApp(): "claude" | "opencode" {
  const override = process.env.CORE_APP;
  if (override === "claude" || override === "opencode") return override;
  const forced = process.env.HUB_CONFIG_DIR;
  if (forced && forced.trim()) return /(^|[\\/])\.?claude([\\/]|$)/i.test(forced) ? "claude" : "opencode";
  return process.argv.join(" ").includes("claude") ? "claude" : "opencode";
}

export function getConfigDir(): string {
  const forced = process.env.HUB_CONFIG_DIR;
  if (forced && forced.trim()) return forced.trim();
  const home = homedir();
  const trimmed = (v) => (v && v.trim() ? v.trim() : "");
  if (activeApp() === "claude") {
    return trimmed(process.env.HUB_CLAUDE_DIR)
      || trimmed(process.env.CLAUDE_CONFIG_DIR)
      || (existsSync(join(home, ".claude")) ? join(home, ".claude") : join(home, ".config", "claude"));
  }
  const xdg = trimmed(process.env.XDG_CONFIG_HOME);
  return trimmed(process.env.HUB_OPENCODE_DIR)
    || trimmed(process.env.OPENCODE_CONFIG_DIR)
    || (xdg ? join(xdg, "opencode") : "")
    || (existsSync(join(home, ".config", "opencode")) ? join(home, ".config", "opencode") : join(home, ".opencode"));
}

export function configFolder(): string {
  return join(getConfigDir(), "config");
}

export function reposDir(): string {
  return join(getConfigDir(), "repos");
}

// The cache subdirectory's name is mirrored from core the same way CONFIG_SUBDIR above is, because
// core-loader derives the same path for the file this one names and the two libs share no code.
export function cacheDir(): string {
  const declared = (process.env.HUB_CACHE_SUBDIR || "").trim();
  const subdir = !declared || declared === "." || declared === ".." || /[\\/]/.test(declared) ? "cache" : declared;
  return join(getConfigDir(), subdir);
}
