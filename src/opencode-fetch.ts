// @ts-nocheck
// OpenCode transport dispatch. core-auth carries NO app-wire translator: it either forwards the
// request to the out-of-process proxy daemon (opt-in), or calls the provider's INJECTED serveDirect
// (the app front-door the provider bundled), or, with neither available, returns a clear 503. The
// app<->IR translation lives entirely in the injected front-door, never here.

export function proxyFetchTarget(env) {
  if (env && env.HUB_OC_PROXY === "1") {
    const parsed = parseInt(env.HUB_PROXY_PORT || "34568", 10);
    const port = Number.isFinite(parsed) && parsed > 0 ? parsed : 34568;
    return { mode: "proxy", port };
  }
  return { mode: "handle" };
}

export function toProxyUrl(originalUrl, port) {
  const u = new URL(originalUrl);
  return "http://127.0.0.1:" + port + u.pathname + u.search;
}

export async function dispatchOpencodeFetch(def, request, env, ctx) {
  const target = proxyFetchTarget(env);
  if (target.mode === "proxy") {
    return fetch(new Request(toProxyUrl(request.url, target.port), request));
  }
  if (typeof def.serveDirect === "function") {
    return def.serveDirect(request, def.handleIr, ctx);
  }
  return new Response(
    JSON.stringify({ error: { type: "loader_error", message: def.id + " has no front-door: run the proxy or bundle the app's direct front-door" } }),
    { status: 503, headers: { "content-type": "application/json" } },
  );
}
