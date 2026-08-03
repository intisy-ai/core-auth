// The app<->IR front-door is owned by the app layer (the loader) and injected here at runtime.
// core-auth names no app: it resolves whatever adapter the app layer published and delegates.

import { pathToFileURL } from "url";

export interface FrontDoorToolkit {
  refreshModels: (def: any, force?: boolean) => Promise<void>;
  listAccounts: (id: string) => any[];
  runProviderMenu: (def: any) => Promise<void>;
  dispatchFetch: (def: any, request: Request, env: any, ctx: any) => Promise<Response>;
  setAppClient: (client: any) => void;
  isTTY: () => boolean;
  configDir: string;
  log: (m: string) => void;
}

export interface AppFrontDoor {
  buildPluginHooks(def: any, input: any, toolkit: FrontDoorToolkit): any;
  serve(request: Request, handleIr: any, ctx: any): Promise<Response>;
}

let CACHED: AppFrontDoor | null | undefined;

function candidatePaths(configDir: string): string[] {
  const fromEnv = process.env.HUB_APP_FRONTDOOR;
  const paths: string[] = [];
  if (fromEnv) paths.push(fromEnv);
  // deployed home-path fallback (app-data-keyed by the home), extensionless-agnostic
  paths.push(configDir + "/repos/opencode-loader/dist/frontdoor.mjs");
  paths.push(configDir + "/repos/opencode-loader/dist/frontdoor.js");
  return paths;
}

// Raw Node ESM import() rejects bare absolute-path specifiers (Windows reads the drive letter as a URL scheme); a real file: URL is required.
export async function importModuleFromPath(p: string): Promise<any> {
  const isUrl = p.startsWith("file:") || p.startsWith("data:") || p.startsWith("node:") || /^[a-z][a-z0-9+.-]*:\/\//i.test(p);
  const specifier = isUrl ? p : pathToFileURL(p).href;
  return import(/* @vite-ignore */ specifier);
}

export async function resolveAppFrontDoor(ctx: { configDir: string }): Promise<AppFrontDoor | null> {
  if (CACHED !== undefined) return CACHED;
  for (const p of candidatePaths(ctx.configDir)) {
    try {
      const mod = await importModuleFromPath(p);
      const fd = mod.appFrontDoor || mod.default;
      if (fd && typeof fd.serve === "function" && typeof fd.buildPluginHooks === "function") {
        CACHED = fd; return CACHED;
      }
    } catch { /* try next candidate */ }
  }
  CACHED = null; return null;
}

export function __resetFrontDoorCacheForTests() { CACHED = undefined; }
