// Single-source paste-OAuth login scaffolding shared by every provider driver:
// parsing a pasted redirect / code, prompting for it on a TTY, building the
// common CoreAccount shape, and assembling the {tokenUrl, clientId, clientSecret?}
// object AccountManager expects as its `oauth` option.

import { createInterface } from "node:readline";
import { getCoreAuth } from "./core-auth-loader.js";
import type { CoreAccount } from "./types.js";

/** A code/state pair parsed from a pasted OAuth callback. */
export interface PastedCallback {
  /** The OAuth authorization code. */
  code: string;
  /** `null` when the callback carried no `state` param. */
  state: string | null;
}

/**
 * Parses whatever a user pastes back after an OAuth redirect.
 *
 * @param input a full redirect URL (`?code=...&state=...`), a bare `code#state` pair, or a bare code alone; empty or omitted reads as nothing pasted
 * @returns `null` if no code could be recovered
 */
export function parsePastedCallback(input?: string): PastedCallback | null {
  return JSON.parse(getCoreAuth().parsePastedCallback(input || "")) as PastedCallback | null;
}

/** Injectable streams for {@link awaitPaste}, so a caller can test it without real stdin. */
export interface AwaitPasteDeps {
  /** Defaults to `process.stdin`. */
  input?: NodeJS.ReadableStream;
  /** Defaults to `process.stdout`. */
  output?: NodeJS.WritableStream;
}

/**
 * Prompts on a single line and resolves with whatever the user pastes.
 *
 * @remarks The caller decides whether to gate this on `isTTY()`.
 */
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

/** A driver's raw OAuth token-exchange result, before it is normalized into a {@link CoreAccount}. */
export interface OauthExchangeResult {
  /** The account's email, when the endpoint reports one. */
  email?: string;
  /** The OAuth refresh token. */
  refresh: string;
  /** The access token. */
  access?: string;
  /** Epoch ms. */
  expires?: number;
}

/**
 * Builds the account shape shared by every driver's post-exchange result.
 *
 * @remarks
 * A caller with provider-specific extras (composite refresh tokens, meta fields) normalizes
 * `refresh` and merges its own `meta` onto the returned object itself.
 */
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

/** Input to {@link oauthConfigFor}. */
export interface OauthConfigInput {
  /** The token endpoint. */
  tokenUrl: string;
  /** OAuth client id. */
  clientId: string;
  /** OAuth client secret, when the client is confidential rather than public PKCE. */
  clientSecret?: string;
}

/** The `{tokenUrl, clientId, clientSecret?}` shape {@link AccountManager}'s `oauth` option consumes. */
export interface OauthConfig {
  /** The token endpoint. */
  tokenUrl: string;
  /** OAuth client id. */
  clientId: string;
  /** OAuth client secret, omitted entirely for a public PKCE client. */
  clientSecret?: string;
}

/**
 * Builds an {@link OauthConfig} for {@link AccountManager}.
 *
 * @remarks
 * `clientSecret` is omitted entirely when absent, matching public PKCE clients (e.g. Claude) that
 * have no secret to send.
 */
export function oauthConfigFor(opts: OauthConfigInput): OauthConfig {
  const config: OauthConfig = { tokenUrl: opts.tokenUrl, clientId: opts.clientId };
  if (opts.clientSecret) config.clientSecret = opts.clientSecret;
  return config;
}
