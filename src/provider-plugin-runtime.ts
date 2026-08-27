// Generic in-process provider plugin. The app-specific hook shape and the app<->IR codec come
// from the app-layer front-door resolved at runtime; core-auth names no app.

import { getConfigDir } from "./env.js";
import { log } from "./log.js";
import { setAppClient } from "./notify.js";
import { listAccounts } from "./accounts.js";
import { isTTY } from "./ui/ansi.js";
import { runProviderMenu } from "./menu.js";
import { refreshModels } from "./refresh.js";
import { resolveAppFrontDoor, type FrontDoorToolkit } from "./frontdoor.js";
import type { ProviderCtx, ProviderDef } from "./types.js";

type ProxyEnv = Record<string, string | undefined>;

function proxyTarget(env: ProxyEnv | undefined): { mode: "proxy"; port: number } | { mode: "direct" } {
  if (env && env.HUB_OC_PROXY === "1") {
    const parsed = parseInt(env.HUB_PROXY_PORT || "34568", 10);
    const port = Number.isFinite(parsed) && parsed > 0 ? parsed : 34568;
    return { mode: "proxy", port };
  }
  return { mode: "direct" };
}

/**
 * Serves a provider's app-wire request, either forwarding it to the `:34567` HTTP proxy when the
 * app runs behind it, or handing it straight to the resolved app front-door.
 *
 * @returns a 503 with an explanatory body when no front-door is available and no proxy is configured
 */
export async function dispatchFetch(def: ProviderDef, request: Request, env: ProxyEnv | undefined, ctx: ProviderCtx): Promise<Response> {
  const target = proxyTarget(env);
  if (target.mode === "proxy") {
    const u = new URL(request.url);
    return fetch(new Request("http://127.0.0.1:" + target.port + u.pathname + u.search, request));
  }
  const fd = await resolveAppFrontDoor({ configDir: ctx.configDir });
  if (fd) return fd.serve(request, def.handleIr, ctx);
  return new Response(
    JSON.stringify({ error: { type: "loader_error", message: def.id + " has no front-door: the app layer (loader) must publish one, or run the proxy" } }),
    { status: 503, headers: { "content-type": "application/json" } },
  );
}

function toolkit(configDir: string): FrontDoorToolkit {
  return {
    // FrontDoorToolkit declares refreshModels as void-returning; core-auth's own refreshModels
    // resolves the refreshed catalog for ITS callers, so this adapts the shape at the crossing
    // without changing what runs (the app front door never read the resolved value anyway).
    refreshModels: async (def: ProviderDef) => { await refreshModels(def); },
    listAccounts,
    runProviderMenu,
    dispatchFetch,
    setAppClient,
    isTTY,
    configDir,
    log,
  };
}

/** The app plugin entry point {@link createProviderPlugin} returns: takes the app's own plugin input, returns its plugin hooks. */
export type ProviderPlugin = (input: any) => Promise<any>;

/**
 * Wraps a provider definition as an in-process app plugin. The app-specific hook shape and the
 * app to IR codec come from the app-layer front-door resolved at runtime; core-auth names no app.
 *
 * @returns a plugin that builds no hooks (an empty object) when no app front-door is found
 */
export function createProviderPlugin(def: ProviderDef): ProviderPlugin {
  return async function (input: any) {
    await refreshModels(def);
    try { setAppClient(input && input.client); } catch { /* best-effort */ }
    const configDir = getConfigDir();
    const fd = await resolveAppFrontDoor({ configDir });
    if (!fd) {
      // No app layer present: nothing app-shaped to build. dispatchFetch still
      // yields a clean 503 if the app somehow calls it.
      return {};
    }
    return fd.buildPluginHooks(def, input, toolkit(configDir));
  };
}
