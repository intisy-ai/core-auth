// @ts-nocheck
// OpenCode integration: merge the provider's models into opencode config and return the auth hook whose loader.fetch calls handle().

import { getConfigDir } from "./env.js";
import { log } from "./log.js";
import { setOpencodeClient } from "./notify.js";
import { listAccounts } from "./accounts.js";
import { isTTY } from "./ui/ansi.js";
import { runProviderMenu } from "./menu.js";
import { refreshModels } from "./refresh.js";

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
              return def.handle(new Request(req, init), { configDir: getConfigDir(), log });
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
