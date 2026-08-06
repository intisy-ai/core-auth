// @ts-nocheck
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
import { parsePastedCallback, toCoreAccount } from "./login.js";
import { startOAuthListener } from "./server.js";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function reportTo(opts) {
  return (opts && opts.log) || ((message) => process.stderr.write(message + "\n"));
}

export function defineOAuthLogin(spec) {
  const {
    provider,
    instructions,
    authorize,
    exchange,
    // A provider with no redirect it can listen on (the page just shows a code) omits this.
    redirectUri,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    // Per-attempt state a provider wants around the exchange, e.g. the proxy an account is
    // bound to. Passed to every hook below and never inspected here.
    begin = () => ({}),
    toAccount = (result) => toCoreAccount(result),
    // A second chance at the exchange, e.g. retrying without a proxy that could not connect.
    // Returns replacement context, or null to accept the failure.
    retry = () => null,
    // A gate between a successful exchange and saving: an account upstream will not serve is
    // worse than no account, because it looks connected.
    accept = () => ({ ok: true }),
    onSaved = () => {},
    pastePrompt,
    signInMessage,
  } = spec;

  async function loginFlow() {
    let context = (await begin()) ?? {};
    const authorization = await authorize(context);
    const listener = redirectUri ? await startOAuthListener(redirectUri, { timeoutMs }) : null;
    const closeListener = () => { try { listener?.close(); } catch { /* already closed */ } };
    let settled = false;

    // Shared by the pasted code and the browser callback, so whichever arrives first wins and
    // the other becomes a no-op rather than a second exchange of a spent code.
    const finish = async (callback) => {
      if (settled) return null;
      if (!callback || !callback.code) return null;
      settled = true;
      try {
        // A bare pasted code carries no state; rebuild it from this flow's own verifier.
        const state = callback.state || encodeState({ verifier: authorization.verifier, ...(authorization.stateExtra ?? {}) });
        let result = await exchange(callback.code, state, context);
        if (result.type !== "success") {
          const retryContext = await retry(result, context);
          if (retryContext) {
            context = retryContext;
            result = await exchange(callback.code, state, context);
          }
        }
        if (result.type !== "success") {
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
      complete: (input) => finish(parsePastedCallback(input)),
      // Present only when there is a listener to wait on, which is what tells a caller
      // whether a browser sign-in can complete without a paste.
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
  async function login(opts) {
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

    let account = null;
    if (isTTY()) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const paste = rl.question(pastePrompt).then((answer) => flow.complete(answer)).catch(() => null);
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
