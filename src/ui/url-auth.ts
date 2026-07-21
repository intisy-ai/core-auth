// @ts-nocheck
// Unified in-chrome URL authentication for any provider whose driver exposes a
// loginFlow() (begin -> url, complete(pasted code), optional loopback auto-capture).
// Builds a menu "input" action a renderer draws natively: it opens the browser,
// shows the URL, and races the loopback listener (where supported) against an
// in-tab pasted code. The browser/loopback is the primary path; paste is the
// fallback. Shared by `oc auth login` (select renderer) and the loader tab so the
// same flow runs everywhere.
//
// A provider's loginFlow() returns:
//   { url, instructions, complete(text) -> account|null,
//     loopback?: Promise<account|null>,   // resolves when the browser hits the
//                                          // localhost redirect; omitted if none
//     cancel?: () => void }                // release the listener when dismissed

import { openBrowser } from "../browser.js";
import { getConfigDir } from "../env.js";
import { log } from "../log.js";
import { refreshModels } from "../refresh.js";

export async function buildLoginInput(def) {
  const flow = await def.loginFlow({ configDir: getConfigDir(), log });
  openBrowser(flow.url);
  return {
    input: {
      title: "Sign in to " + def.label,
      message: (flow.instructions || "Approve in your browser, then paste the authorization code here.") + (flow.url ? "\n\n" + flow.url : ""),
      // shown while complete() runs: the token exchange + project discovery can
      // take ~10-15s (proxied), so the field reports progress instead of vanishing
      pendingLabel: "Adding account… (exchanging the code, this can take a few seconds)",
      // paste fallback: trade the pasted code/redirect URL for an account, then pull
      // the now-authed account's models so they appear without an app restart
      complete: async (text) => { const account = await flow.complete(text); if (account && account.refresh) await refreshModels(def).catch(() => {}); return { refresh: true }; },
      // primary path: the loopback listener auto-completes the input when it fires
      background: flow.loopback ? flow.loopback.then(async (account) => { if (!account) return null; await refreshModels(def).catch(() => {}); return { refresh: true }; }).catch(() => null) : null,
      // release the listener when the input is dismissed / superseded
      onClose: typeof flow.cancel === "function" ? flow.cancel : undefined,
    },
  };
}
