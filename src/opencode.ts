// @ts-nocheck
// OpenCode integration: merge the provider's models into opencode config and return the auth hook whose loader.fetch calls handle().

import { getConfigDir } from "./env.js";
import { log } from "./log.js";
import { setOpencodeClient } from "./notify.js";
import { listAccounts } from "./accounts.js";
import { isTTY } from "./ui/ansi.js";
import { runProviderMenu } from "./menu.js";
import { refreshModels } from "./refresh.js";
import { handleOpencodeViaIr } from "./opencode-ir.js";

// Opt-in proxy routing (parity with the claude-code-loader proxy path). By
// DEFAULT OpenCode routes in-process: loader.fetch calls def.handle() directly,
// so this is behaviour-neutral unless the oc wrapper turns it on. When the
// wrapper sets HUB_OC_PROXY=1 (+ HUB_PROXY_PORT for the opencode-proxy daemon),
// requests are forwarded to that local daemon instead, which resolves the
// provider chain and calls handle() itself. core-auth stays app-agnostic: it
// only reads an env flag, never the loader's config schema.
export function proxyFetchTarget(env) {
  if (env && env.HUB_OC_PROXY === "1") {
    const parsed = parseInt(env.HUB_PROXY_PORT || "34568", 10);
    // A misconfigured (non-numeric) port would otherwise make toProxyUrl build
    // "http://127.0.0.1:NaN/..." and throw on every request; degrade to default.
    const port = Number.isFinite(parsed) && parsed > 0 ? parsed : 34568;
    return { mode: "proxy", port };
  }
  return { mode: "handle" };
}

// Rewrite a provider request URL onto the local proxy daemon, preserving the
// path + query (e.g. /v1/messages) so the daemon's routing profile matches it.
export function toProxyUrl(originalUrl, port) {
  const u = new URL(originalUrl);
  return "http://127.0.0.1:" + port + u.pathname + u.search;
}

// `oc auth login` for a provider with an account controller (in a TTY) opens our
// interactive account-management TUI (runProviderMenu: list/add/remove/verify),
// where "Add account" runs the driver's own OAuth login (loopback listener +
// terminal paste fallback). Otherwise it falls back to opencode's `code` oauth
// method: opencode prompts for the pasted code / redirect URL and hands it to
// callback(code) — terminal-conflict-free for non-TTY / container-only flows.
function authMethods(def) {
  if (typeof def.loginFlow !== "function") {
    return [{ label: def.label + " (via core-auth)", type: "api" }];
  }
  return [{
    type: "oauth",
    label: def.label,
    authorize: async function () {
      if (def.accounts && isTTY()) {
        try { await runProviderMenu(def); } catch (e) { log("account menu failed: " + e); }
        await refreshModels(def, true);   // pull the now-authed account's live model catalog
        return { url: "", instructions: def.label + " accounts updated.", method: "auto", callback: async () => ({ type: "success", refresh: "core-auth", access: "", expires: 0 }) };
      }
      const flow = await def.loginFlow({ configDir: getConfigDir(), log });
      return {
        url: flow.url,
        instructions: flow.instructions || ("Sign in to " + def.label + ", then paste the authorization code (or the full redirect URL) here."),
        method: "code",
        callback: async function (code) {
          try {
            const account = await flow.complete(code);
            if (!account || !account.refresh) return { type: "failed" };
            await refreshModels(def, true);   // pull the now-authed account's live model catalog
            return { type: "success", refresh: account.refresh, access: account.access || "", expires: account.expires || 0 };
          } catch (error) { log("oauth login failed: " + error); return { type: "failed" }; }
        },
      };
    },
  }];
}

export function createOpencodePlugin(def) {
  const opencodeProvider = def.opencodeProvider || "anthropic";
  return async function (input) {
    await refreshModels(def, true);
    // hand the opencode client to the notification layer so notify() can toast
    try { setOpencodeClient(input && input.client); } catch { /* best-effort */ }
    // when accounts already exist, seed opencode's auth entry so it routes through our loader without the user running `oc auth login`
    try {
      const client = input && input.client;
      if (client && client.auth && listAccounts(def.id).length > 0) {
        await client.auth.set({ path: { id: opencodeProvider }, body: { type: "oauth", refresh: "", access: "", expires: 0 } });
      }
    } catch (e) { log("auto-route seed failed: " + e); }
    const hooks = {
      auth: {
        provider: opencodeProvider,
        methods: authMethods(def),
        loader: async function () {
          return {
            apiKey: def.id,
            fetch: function (req, init) {
              const request = new Request(req, init);
              const target = proxyFetchTarget(process.env);
              if (target.mode === "proxy") {
                return fetch(new Request(toProxyUrl(request.url, target.port), request));
              }
              // NATIVE in-process FRONT-DOOR owns app<->IR: decode the Anthropic wire to IR, call the
              // provider's IR-native handleIr, encode the IR result back (parity with core-proxy's
              // server front-door). Every ecosystem provider is IR-native post-T4; a provider that
              // supplies neither handleIr nor a legacy handle() is a packaging error, surfaced as a
              // 503 rather than crashing on an undefined call.
              const ctx = { configDir: getConfigDir(), log };
              if (typeof def.handleIr === "function") {
                return handleOpencodeViaIr(def, request, ctx);
              }
              if (typeof def.handle === "function") {
                return def.handle(request, ctx);
              }
              return new Response(
                JSON.stringify({ error: { type: "loader_error", message: def.id + " has no IR handler" } }),
                { status: 503, headers: { "content-type": "application/json" } },
              );
            },
          };
        },
      },
    };
    // A provider may contribute extra opencode hooks (e.g. an `event` handler for
    // session recovery). Generic passthrough — core doesn't know what they do.
    if (typeof def.opencodeHooks === "function") {
      try { Object.assign(hooks, (await def.opencodeHooks(input)) || {}); }
      catch (e) { log("opencodeHooks failed: " + e); }
    }
    return hooks;
  };
}
