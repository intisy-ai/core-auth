// @ts-nocheck
// Filesystem locations, derived from the active app's config dir. Resolution mirrors
// core's getAppConfigDir so the two libs AGREE: HUB_CONFIG_DIR (the loader's forced
// dir, reliable even headless under the proxy) → the app's OWN native var
// (CLAUDE_CONFIG_DIR / OPENCODE_CONFIG_DIR|XDG_CONFIG_HOME) → fs fallback.
// (core-auth is standalone and doesn't bundle core, so the logic is mirrored, not imported.)

import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function activeApp(): "claude" | "opencode" {
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
