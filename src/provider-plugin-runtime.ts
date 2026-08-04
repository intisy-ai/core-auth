// @ts-nocheck
// Generic in-process provider plugin. The app-specific hook shape and the app<->IR codec come
// from the app-layer front-door resolved at runtime; core-auth names no app.

import { getConfigDir } from "./env.js";
import { log } from "./log.js";
import { setAppClient } from "./notify.js";
import { listAccounts } from "./accounts.js";
import { isTTY } from "./ui/ansi.js";
import { runProviderMenu } from "./menu.js";
import { refreshModels } from "./refresh.js";
import { resolveAppFrontDoor } from "./frontdoor.js";

function proxyTarget(env) {
  if (env && env.HUB_OC_PROXY === "1") {
    const parsed = parseInt(env.HUB_PROXY_PORT || "34568", 10);
    const port = Number.isFinite(parsed) && parsed > 0 ? parsed : 34568;
    return { mode: "proxy", port };
  }
  return { mode: "direct" };
}

export async function dispatchFetch(def, request, env, ctx) {
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

function toolkit(configDir) {
  return { refreshModels, listAccounts, runProviderMenu, dispatchFetch, setAppClient, isTTY, configDir, log };
}

export type ProviderPlugin = (input: any) => Promise<any>;

export function createProviderPlugin(def) {
  return async function (input) {
    await refreshModels(def, true);
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
