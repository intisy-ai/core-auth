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
import { emitActivity } from "../activity.js";
import type { CoreAccount, ProviderDef } from "../types.js";
import type { AccountMenuInput, AccountMenuNavigation } from "./menu-model.js";

function loginFailedSpec(provider: string, message: string) {
  return { topic: "account", action: "login_failed", impact: "error", outcome: "failed", subject: { kind: "account", id: "?" }, details: { provider, message } };
}

function loginSucceededSpec(provider: string, account: CoreAccount, durationMs: number) {
  const subjectId = account.email || account.id;
  return { topic: "account", action: "login_succeeded", impact: "notice", outcome: "ok", durationMs, subject: { kind: "account", id: subjectId, label: subjectId }, details: { provider } };
}

/**
 * @remarks
 * Callers must confirm `def.loginFlow` exists first (e.g. `typeof def.loginFlow === "function"`,
 * as menu-model.ts's addAccount item does); called otherwise, this throws immediately below.
 */
export async function buildLoginInput(def: ProviderDef): Promise<{
  /** The menu navigation a renderer applies to open this login prompt. */
  input: AccountMenuInput;
}> {
  const flow = await def.loginFlow!({ configDir: getConfigDir(), log });
  openBrowser(flow.url);
  const provider = def.id;
  // a login is the one account operation a user WAITS on (browser round trip, token
  // exchange, project discovery), so how long it took is worth recording
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;
  return {
    input: {
      title: "Sign in to " + def.label,
      message: (flow.instructions || "Approve in your browser, then paste the authorization code here.") + (flow.url ? "\n\n" + flow.url : ""),
      // shown while complete() runs: the token exchange + project discovery can
      // take ~10-15s (proxied), so the field reports progress instead of vanishing
      pendingLabel: "Adding account… (exchanging the code, this can take a few seconds)",
      // paste fallback: trade the pasted code/redirect URL for an account, then pull
      // the now-authed account's models so they appear without an app restart
      complete: async (text: string): Promise<AccountMenuNavigation> => {
        let account: CoreAccount | null;
        try {
          account = await flow.complete(text);
        } catch (error) {
          emitActivity(loginFailedSpec(provider, error instanceof Error ? error.message : String(error)), provider);
          throw error;
        }
        if (account && account.refresh) {
          await refreshModels(def).catch(() => {});
          emitActivity(loginSucceededSpec(provider, account, elapsed()), provider);
        } else {
          emitActivity(loginFailedSpec(provider, "login did not return an account"), provider);
        }
        return { refresh: true };
      },
      // primary path: the loopback listener auto-completes the input when it fires
      background: flow.loopback ? flow.loopback.then(async (account): Promise<{ refresh: true } | null> => {
        if (!account) { emitActivity(loginFailedSpec(provider, "loopback login returned no account"), provider); return null; }
        await refreshModels(def).catch(() => {});
        emitActivity(loginSucceededSpec(provider, account, elapsed()), provider);
        return { refresh: true };
      }).catch((error: unknown) => {
        emitActivity(loginFailedSpec(provider, error instanceof Error ? error.message : String(error)), provider);
        return null;
      }) : undefined,
      // release the listener when the input is dismissed / superseded
      onClose: typeof flow.cancel === "function" ? flow.cancel : undefined,
    },
  };
}
