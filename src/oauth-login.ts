// The one OAuth login flow every provider builds on. A provider supplies only what is
// genuinely its own (how to build an authorize URL, how to exchange a code, and any gate or
// binding it needs around that); everything else here is the same for all of them and used
// to be copied into each driver: the settled guard so a pasted code and a browser callback
// cannot both complete, rebuilding a missing state from this flow's own verifier, saving the
// account, running the loopback listener, and racing a terminal paste against it.
//
// defineOAuthLogin(spec) returns the two entry points a driver exports:
//   loginFlow() - the split begin/complete form Cairn, the TUI and opencode drive
//   login(opts) - the all-in-one CLI form that opens a browser and waits

import { createInterface } from "node:readline";
import { addAccount } from "./accounts.js";
import { openBrowser } from "./browser.js";
import { isTTY } from "./ui/ansi.js";
import { encodeState } from "./oauth.js";
import { parsePastedCallback, toCoreAccount, type OauthExchangeResult } from "./login.js";
import { startOAuthListener } from "./server.js";
import type { CoreAccount } from "./types.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export interface OAuthLoginOpts {
  log?: (message: string) => void;
  code?: string;
}

function reportTo(opts?: OAuthLoginOpts): (message: string) => void {
  return (opts && opts.log) || ((message: string) => process.stderr.write(message + "\n"));
}

export interface OAuthAuthorization {
  url: string;
  verifier?: string;
  stateExtra?: Record<string, unknown>;
}

export interface OAuthAcceptVerdict {
  ok: boolean;
  message?: string;
}

// The exchange result: a failure carries only `type` (anything other than "success") and an
// optional `error`; a success additionally carries the token fields the default `toAccount`
// hands straight to `toCoreAccount`.
export type OAuthExchangeOutcome =
  | ({ type: "success" } & OauthExchangeResult)
  | { type: string; error?: string };

// `type` on the failure branch is a general string (a provider's own failure label), which
// overlaps `"success"` at the type level, so a plain `result.type !== "success"` comparison
// cannot discriminate the union; this guard narrows it explicitly instead.
function isSuccessOutcome(result: OAuthExchangeOutcome): result is { type: "success" } & OauthExchangeResult {
  return result.type === "success";
}

interface OAuthCallbackInput {
  code: string | null;
  state: string | null;
}

export interface OAuthLoginSpec {
  provider: string;
  instructions?: string;
  authorize: (context: unknown) => Promise<OAuthAuthorization>;
  exchange: (code: string, state: string, context: unknown) => Promise<OAuthExchangeOutcome>;
  // A provider with no redirect it can listen on (the page just shows a code) omits this.
  redirectUri?: string;
  timeoutMs?: number;
  // Per-attempt state a provider wants around the exchange, e.g. the proxy an account is
  // bound to. Passed to every hook below and never inspected here.
  begin?: () => unknown;
  toAccount?: (result: OauthExchangeResult, context: unknown) => CoreAccount | Promise<CoreAccount>;
  // A second chance at the exchange, e.g. retrying without a proxy that could not connect.
  // Returns replacement context, or null to accept the failure.
  retry?: (result: OAuthExchangeOutcome, context: unknown) => unknown;
  // A gate between a successful exchange and saving: an account upstream will not serve is
  // worse than no account, because it looks connected.
  accept?: (account: CoreAccount, result: OauthExchangeResult, context: unknown) => OAuthAcceptVerdict | Promise<OAuthAcceptVerdict>;
  onSaved?: (account: CoreAccount, context: unknown) => void | Promise<void>;
  pastePrompt?: string;
  signInMessage?: string;
}

export interface OAuthLoginFlowHandle {
  url: string;
  instructions?: string;
  complete: (input: string) => Promise<CoreAccount | null>;
  // Present only when there is a listener to wait on, which is what tells a caller
  // whether a browser sign-in can complete without a paste.
  loopback?: Promise<CoreAccount | null>;
  cancel: () => void;
}

export function defineOAuthLogin(spec: OAuthLoginSpec): { loginFlow: () => Promise<OAuthLoginFlowHandle>; login: (opts?: OAuthLoginOpts) => Promise<CoreAccount> } {
  const {
    provider,
    instructions,
    authorize,
    exchange,
    redirectUri,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    begin = () => ({}),
    toAccount = (result: OauthExchangeResult) => toCoreAccount(result),
    retry = () => null,
    accept = () => ({ ok: true }),
    onSaved = () => {},
    pastePrompt,
    signInMessage,
  } = spec;

  async function loginFlow(): Promise<OAuthLoginFlowHandle> {
    let context: unknown = (await begin()) ?? {};
    const authorization = await authorize(context);
    const listener = redirectUri ? await startOAuthListener(redirectUri, { timeoutMs }) : null;
    const closeListener = () => { try { listener?.close(); } catch { /* already closed */ } };
    let settled = false;

    // Shared by the pasted code and the browser callback, so whichever arrives first wins and
    // the other becomes a no-op rather than a second exchange of a spent code.
    const finish = async (callback: OAuthCallbackInput | null): Promise<CoreAccount | null> => {
      if (settled) return null;
      if (!callback || !callback.code) return null;
      settled = true;
      try {
        // A bare pasted code carries no state; rebuild it from this flow's own verifier.
        const state = callback.state || encodeState({ verifier: authorization.verifier, ...(authorization.stateExtra ?? {}) });
        let result = await exchange(callback.code, state, context);
        if (!isSuccessOutcome(result)) {
          const retryContext = await retry(result, context);
          if (retryContext) {
            context = retryContext;
            result = await exchange(callback.code, state, context);
          }
        }
        if (!isSuccessOutcome(result)) {
          process.stderr.write(`${provider} login failed, token exchange error: ${result.error || "unknown"}\n`);
          return null;
        }
        const account = await toAccount(result, context);
        const verdict = await accept(account, result, context);
        if (!verdict.ok) {
          if (verdict.message) process.stderr.write(verdict.message + "\n");
          return null;
        }
        addAccount(provider, account);
        await onSaved(account, context);
        return account;
      } finally {
        closeListener();
      }
    };

    return {
      url: authorization.url,
      instructions,
      complete: (input: string) => finish(parsePastedCallback(input)),
      loopback: listener
        ? listener.waitForCallback()
            .then((url) => finish({ code: url.searchParams.get("code"), state: url.searchParams.get("state") }))
            .catch(() => null)
        : undefined,
      cancel: closeListener,
    };
  }

  // The CLI form. With a listener it races the browser against a terminal paste, closing the
  // readline as soon as either settles so a browser win does not leave the prompt dangling.
  async function login(opts?: OAuthLoginOpts): Promise<CoreAccount> {
    const log = reportTo(opts);
    const pasted = opts && opts.code;
    const flow = await loginFlow();

    if (pasted) {
      const account = await flow.complete(pasted);
      if (!account) throw new Error("login failed");
      log(`Logged in${account.email ? " as " + account.email : ""} and saved to the ${provider} account pool.`);
      return account;
    }

    log(`${signInMessage}\n\n  ${flow.url}\n`);
    openBrowser(flow.url);

    let account: CoreAccount | null = null;
    if (isTTY()) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const paste: Promise<CoreAccount | null> = new Promise<string>((resolve) => {
        rl.question(pastePrompt || "", (answer) => resolve(answer));
      }).then((answer) => flow.complete(answer)).catch(() => null);
      account = flow.loopback ? await Promise.race([flow.loopback, paste]) : await paste;
      try { rl.close(); } catch { /* already closed */ }
    } else if (flow.loopback) {
      account = await flow.loopback;
    }

    try { flow.cancel(); } catch { /* already closed */ }
    if (!account) throw new Error("login failed");
    log(`Logged in${account.email ? " as " + account.email : ""} and saved to the ${provider} account pool.`);
    return account;
  }

  return { loginFlow, login };
}
