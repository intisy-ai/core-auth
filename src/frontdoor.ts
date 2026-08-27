// The app<->IR front-door is owned by the app layer (the loader) and injected here at runtime.
// core-auth names no app: it resolves whatever adapter the app layer published and delegates.

import { pathToFileURL } from "url";

/** The core-auth primitives an injected {@link AppFrontDoor} is handed so it can build the app's plugin hooks without importing core-auth itself. */
export interface FrontDoorToolkit {
  /** Refreshes a provider's model catalog. */
  refreshModels: (def: any, force?: boolean) => Promise<void>;
  /** Lists a provider's stored accounts as presentation views. */
  listAccounts: (id: string) => any[];
  /** Runs the shared account-management menu for a provider. */
  runProviderMenu: (def: any) => Promise<void>;
  /** Serves a provider's app-wire request. */
  dispatchFetch: (def: any, request: Request, env: any, ctx: any) => Promise<Response>;
  /** Registers the app's plugin client for toast notifications. */
  setAppClient: (client: any) => void;
  /** Whether stdin is an interactive terminal. */
  isTTY: () => boolean;
  /** The active app's home directory. */
  configDir: string;
  /** Writes to core-auth's own log. */
  log: (m: string) => void;
}

/** The app-owned adapter between the app's plugin hooks/wire format and canonical IR, resolved at runtime by {@link resolveAppFrontDoor}. */
export interface AppFrontDoor {
  /** Builds the app-specific plugin hooks for a provider. */
  buildPluginHooks(def: any, input: any, toolkit: FrontDoorToolkit): any;
  /** Decodes an app-wire request into IR, calls `handleIr`, and encodes the result back to the app's wire format. */
  serve(request: Request, handleIr: any, ctx: any): Promise<Response>;
}

let CACHED: AppFrontDoor | null | undefined;

function isAppFrontDoor(value: unknown): value is AppFrontDoor {
  const candidate = value as { serve?: unknown; buildPluginHooks?: unknown } | null | undefined;
  return !!candidate && typeof candidate.serve === "function" && typeof candidate.buildPluginHooks === "function";
}

function candidatePaths(configDir: string): string[] {
  const fromEnv = process.env.HUB_APP_FRONTDOOR;
  const paths: string[] = [];
  if (fromEnv) paths.push(fromEnv);
  // generic deployed home-path fallback, no app/vendor name
  paths.push(configDir + "/frontdoor/app-frontdoor.mjs");
  return paths;
}

/**
 * Imports a module by absolute path or URL.
 *
 * @remarks Raw Node ESM `import()` rejects bare absolute-path specifiers (Windows reads the drive letter as a URL scheme), so a plain path is converted to a real `file:` URL first.
 */
export async function importModuleFromPath(p: string): Promise<any> {
  const isUrl = p.startsWith("file:") || p.startsWith("data:") || p.startsWith("node:") || /^[a-z][a-z0-9+.-]*:\/\//i.test(p);
  const specifier = isUrl ? p : pathToFileURL(p).href;
  return import(/* @vite-ignore */ specifier);
}

/** Resolves and caches the app layer's injected {@link AppFrontDoor}; `null` when none is found. */
export async function resolveAppFrontDoor(ctx: { configDir: string }): Promise<AppFrontDoor | null> {
  if (CACHED !== undefined) return CACHED;
  for (const p of candidatePaths(ctx.configDir)) {
    try {
      const mod = await importModuleFromPath(p);
      const fd: unknown = mod.appFrontDoor || mod.default;
      if (isAppFrontDoor(fd)) {
        CACHED = fd; return CACHED;
      }
    } catch { /* try next candidate */ }
  }
  CACHED = null; return null;
}

/** Clears {@link resolveAppFrontDoor}'s cache; test-only. */
export function __resetFrontDoorCacheForTests() { CACHED = undefined; }
