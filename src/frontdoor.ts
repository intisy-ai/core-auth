// The app<->IR front-door is owned by the app layer (the loader) and injected here at runtime.
// core-auth names no app: it resolves whatever adapter the app layer published and delegates.

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

export async function resolveAppFrontDoor(ctx: { configDir: string }): Promise<AppFrontDoor | null> {
  if (CACHED !== undefined) return CACHED;
  for (const p of candidatePaths(ctx.configDir)) {
    try {
      const mod = await import(/* @vite-ignore */ p);
      const fd = mod.appFrontDoor || mod.default;
      if (fd && typeof fd.serve === "function" && typeof fd.buildPluginHooks === "function") {
        CACHED = fd; return CACHED;
      }
    } catch { /* try next candidate */ }
  }
  CACHED = null; return null;
}

export function __resetFrontDoorCacheForTests() { CACHED = undefined; }
