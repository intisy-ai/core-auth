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

/** Options to the all-in-one CLI `login()` form. */
export interface OAuthLoginOpts {
  /** Where progress messages go; defaults to stderr. */
  log?: (message: string) => void;
  /** A code pasted ahead of time, skipping the browser/paste race entirely. */
  code?: string;
}

function reportTo(opts?: OAuthLoginOpts): (message: string) => void {
  return (opts && opts.log) || ((message: string) => process.stderr.write(message + "\n"));
}

/** What a provider's `authorize` hook returns: the URL to send the user to, plus whatever the exchange later needs to rebuild `state`. */
export interface OAuthAuthorization {
  /** Where to send the user to sign in. */
  url: string;
  /** PKCE verifier, rebuilt into `state` if a pasted callback carries none. */
  verifier?: string;
  /** Extra fields merged into the rebuilt `state`. */
  stateExtra?: Record<string, unknown>;
}

/** Whether a successfully exchanged account may actually be saved; `message` is shown to the user on rejection. */
export interface OAuthAcceptVerdict {
  /** Whether the account is accepted. */
  ok: boolean;
  /** Shown to the user when `ok` is `false`. */
  message?: string;
}

/**
 * A provider's `exchange` result: a failure carries only `type` (anything other than
 * `"success"`, the provider's own failure label) and an optional `error`; a success additionally
 * carries the token fields the default `toAccount` hands straight to `toCoreAccount`.
 */
export type OAuthExchangeOutcome =
  | ({
      /** Discriminates a successful exchange. */
      type: "success";
    } & OauthExchangeResult)
  | {
      /** The provider's own failure label. */
      type: string;
      /** Human-readable failure detail. */
      error?: string;
    };

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

/** What a provider supplies to {@link defineOAuthLogin}; everything else about the flow is shared. */
export interface OAuthLoginSpec {
  /** The provider id, used for logging and the saved account's pool. */
  provider: string;
  /** Shown alongside the authorize URL. */
  instructions?: string;
  /** Builds the authorize URL and any state the exchange needs. */
  authorize: (context: unknown) => Promise<OAuthAuthorization>;
  /** Trades a code and state for tokens. */
  exchange: (code: string, state: string, context: unknown) => Promise<OAuthExchangeOutcome>;
  /** Omitted by a provider with no redirect it can listen on, where the page just shows a code to paste. */
  redirectUri?: string;
  /** How long to wait for the browser callback before timing out. */
  timeoutMs?: number;
  /** Builds per-attempt state a provider wants around the exchange, e.g. the proxy an account is bound to; passed to every hook below and never inspected here. */
  begin?: () => unknown;
  /** Normalizes an exchange result into a {@link CoreAccount}; defaults to {@link toCoreAccount}. */
  toAccount?: (result: OauthExchangeResult, context: unknown) => CoreAccount | Promise<CoreAccount>;
  /** A second chance at the exchange, e.g. retrying without a proxy that could not connect. Returns replacement context, or `null`/falsy to accept the failure. */
  retry?: (result: OAuthExchangeOutcome, context: unknown) => unknown;
  /** A gate between a successful exchange and saving: an account upstream will not serve is worse than no account, because it looks connected. */
  accept?: (account: CoreAccount, result: OauthExchangeResult, context: unknown) => OAuthAcceptVerdict | Promise<OAuthAcceptVerdict>;
  /** Runs after the account is saved. */
  onSaved?: (account: CoreAccount, context: unknown) => void | Promise<void>;
  /** Prompt text for the terminal paste fallback. */
  pastePrompt?: string;
  /** Message shown before opening the browser in the CLI form. */
  signInMessage?: string;
}

/** The split begin/complete handle {@link defineOAuthLogin}'s `loginFlow()` returns, driven by Cairn, the TUI and opencode. */
export interface OAuthLoginFlowHandle {
  /** Where to send the user to sign in. */
  url: string;
  /** Extra guidance shown alongside the URL. */
  instructions?: string;
  /** Completes the flow with a pasted code or redirect URL; omitted when the caller relies on {@link loopback} instead. */
  complete: (input?: string) => Promise<CoreAccount | null>;
  /** Present only when there is a listener to wait on; tells a caller whether a browser sign-in can complete without a paste. */
  loopback?: Promise<CoreAccount | null>;
  /** Releases the listener when the flow is dismissed or superseded. */
  cancel: () => void;
}

/**
 * Builds the two entry points every OAuth provider exports from one spec: `loginFlow()`, the
 * split begin/complete form, and `login()`, the all-in-one CLI form that opens a browser and
 * waits. Both share the settled guard (a pasted code and a browser callback cannot both
 * complete), state rebuilding, account saving, and the loopback-vs-paste race, so a driver
 * supplies only what is genuinely its own: how to build an authorize URL and how to exchange a
 * code.
 */
export function defineOAuthLogin(spec: OAuthLoginSpec): {
  /** The split begin/complete form Cairn, the TUI and opencode drive. */
  loginFlow: () => Promise<OAuthLoginFlowHandle>;
  /** The all-in-one CLI form that opens a browser and waits. */
  login: (opts?: OAuthLoginOpts) => Promise<CoreAccount>;
} {
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
      complete: (input?: string) => finish(parsePastedCallback(input)),
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
