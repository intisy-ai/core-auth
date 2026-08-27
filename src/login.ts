// Single-source paste-OAuth login scaffolding shared by every provider driver:
// parsing a pasted redirect / code, prompting for it on a TTY, building the
// common CoreAccount shape, and assembling the {tokenUrl, clientId, clientSecret?}
// object AccountManager expects as its `oauth` option.

import { createInterface } from "node:readline";
import { getCoreAuth } from "./core-auth-loader.js";
import type { CoreAccount } from "./types.js";

export interface PastedCallback {
  code: string;
  state: string | null;
}

// Accepts a full redirect URL (?code=...&state=...), a bare `code#state` pair, or
// a bare code pasted alone. Covers every pasted-callback shape used across drivers.
export function parsePastedCallback(input: string): PastedCallback | null {
  return JSON.parse(getCoreAuth().parsePastedCallback(input || "")) as PastedCallback | null;
}

export interface AwaitPasteDeps {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

// Thin readline single-line prompt. Streams are injectable so it is testable
// without real stdin; the caller decides whether to gate this on isTTY().
export function awaitPaste(prompt: string, deps?: AwaitPasteDeps): Promise<string> {
  const input = deps?.input || process.stdin;
  const output = deps?.output || process.stdout;
  const rl = createInterface({ input, output });
  return new Promise<string>((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  }).finally(() => {
    try { rl.close(); } catch {}
  });
}

export interface OauthExchangeResult {
  email?: string;
  refresh: string;
  access?: string;
  expires?: number;
}

// The account shape shared by every driver's post-exchange result. Callers with
// provider-specific extras (composite refresh tokens, meta fields) normalize
// `refresh` and merge their own `meta` onto the returned object themselves.
export function toCoreAccount(result: OauthExchangeResult): CoreAccount {
  return {
    id: result.email || result.refresh.slice(0, 16),
    email: result.email,
    refresh: result.refresh,
    access: result.access,
    expires: result.expires,
    addedAt: Date.now(),
    lastUsed: 0,
    enabled: true,
    rateLimitResetTimes: {},
    meta: {},
  };
}

export interface OauthConfigInput {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
}

export interface OauthConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
}

// The {tokenUrl, clientId, clientSecret?} shape AccountManager's `oauth` option
// consumes (see manager.ts). clientSecret is omitted entirely when absent, matching
// public PKCE clients (e.g. Claude) that have no secret to send.
export function oauthConfigFor(opts: OauthConfigInput): OauthConfig {
  const config: OauthConfig = { tokenUrl: opts.tokenUrl, clientId: opts.clientId };
  if (opts.clientSecret) config.clientSecret = opts.clientSecret;
  return config;
}
