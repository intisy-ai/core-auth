// @ts-nocheck
// Filesystem locations, derived from the active app's config dir. Resolution is
// HUB_CONFIG_DIR (the loader's forced dir, reliable even headless under the proxy)
// first, then the active app's declared home from the app registry (./app-registry.js).
// (core-auth is standalone and doesn't bundle core, so the registry read is mirrored, not imported.)

import { join } from "path";
import { activeAppIdFromData, activeDescriptor, resolveHome } from "./app-registry.js";

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
// own, so it cannot import core's app-detection primitive; every other core-auth
// module that needs to know which app it runs under MUST import this rather than
// re-deriving its own check.
export function activeAppId(): string {
  return activeAppIdFromData();
}

export function getConfigDir(): string {
  const forced = process.env.HUB_CONFIG_DIR;
  if (forced && forced.trim()) return forced.trim();
  const desc = activeDescriptor();
  return desc ? resolveHome(desc) : "";
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
