// Generic OAuth helpers + token refresh; the driver supplies its own tokenUrl/clientId/clientSecret.
// The refresh call itself is single-sourced in Java (TokenRefresh, accounts) behind
// CoreAuthJs.refreshToken; what stays here is the transport it runs over and the error shape
// callers branch on.
import { getCoreAuth } from "./core-auth-loader.js";
import { proxiedFetch, type ProxiedFetchOpts } from "./net.js";
import type { CoreAccount } from "./types.js";

/** Whether `auth` is an OAuth-style credential, as opposed to an API key or other auth shape. */
export function isOAuthAuth(auth: unknown): auth is {
  /** Discriminates an OAuth-style credential from other auth shapes. */
  type: "oauth";
} {
  return !!auth && typeof auth === "object" && (auth as { type?: unknown }).type === "oauth";
}

/**
 * Whether an account's access token is expired or missing.
 *
 * @remarks
 * Delegates to the single-sourced predicate in Java (`TokenRefresh.accessTokenExpired`,
 * `accounts`), which applies a 60s clock-skew buffer.
 */
export function accessTokenExpired(auth: Pick<CoreAccount, "access" | "expires"> | null | undefined): boolean {
  return getCoreAuth().accessTokenExpired(JSON.stringify(auth || {}), Date.now());
}

/**
 * Computes the absolute expiry time for a token issued at `requestTimeMs`.
 *
 * @param requestTimeMs when the token was issued, in epoch milliseconds
 * @param expiresInSeconds the endpoint's `expires_in`; a non-number is read as "not reported"
 * @remarks Delegates to the single-sourced `OAuthWire` calculation in Java (`accounts`), which both OAuth grants use.
 */
export function calculateTokenExpiry(requestTimeMs: number, expiresInSeconds: unknown): number {
  const seconds = typeof expiresInSeconds === "number" ? expiresInSeconds : NaN;
  return getCoreAuth().calculateTokenExpiry(requestTimeMs, seconds);
}

/** Packs an OAuth `state` param as URL-safe base64 so it survives a redirect roundtrip. */
export function encodeState(payload: unknown): string {
  return getCoreAuth().encodeState(JSON.stringify(payload));
}

interface DecodeStateEnvelope {
  error?: string;
  payload: string;
}

/**
 * The payload {@link decodeState} hands back: whatever was passed to {@link encodeState}, which
 * always carries a PKCE `verifier` because the Java side refuses to decode a state without one.
 */
export interface DecodedState {
  /** The PKCE verifier {@link encodeState} was called with. */
  verifier: string;
  /** Whatever else the caller packed into the encoded payload. */
  [key: string]: unknown;
}

/**
 * Unpacks a `state` param produced by {@link encodeState}.
 *
 * @throws if the state is malformed or its PKCE verifier is missing
 */
export function decodeState(state: unknown): DecodedState {
  const result: DecodeStateEnvelope = JSON.parse(getCoreAuth().decodeState(String(state)));
  if (result.error) throw new Error(result.error);
  return JSON.parse(result.payload);
}

/** Options for constructing a {@link TokenRefreshError}. */
export interface TokenRefreshErrorOptions {
  /** The error message. */
  message: string;
  /** The token endpoint's own error code, e.g. `"invalid_grant"`. */
  code?: string;
  /** The token endpoint's human-readable error description. */
  description?: string;
  /** The HTTP status the token endpoint returned. */
  status?: number;
}

/** A failure from {@link refreshAccessToken}; `revoked` is true when the refresh token itself needs reauth. */
export class TokenRefreshError extends Error {
  /** The token endpoint's own error code, e.g. `"invalid_grant"`. */
  readonly code?: string;
  /** The token endpoint's human-readable error description. */
  readonly description?: string;
  /** The HTTP status the token endpoint returned. */
  readonly status?: number;
  /** Whether the refresh token itself was revoked, so the account needs a fresh login rather than a retry. */
  readonly revoked: boolean;
  constructor(options: TokenRefreshErrorOptions) {
    super(options.message);
    this.name = "TokenRefreshError";
    this.code = options.code;
    this.description = options.description;
    this.status = options.status;
    this.revoked = options.code === "invalid_grant";   // refresh token revoked -> reauth
  }
}

interface HttpSendRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

// A JSON transport for the Java refresh call, built on net.ts's proxy-aware fetch so a dead proxy
// falls back to a direct attempt in the ONE place that mechanic lives. Any reported status comes
// back as data; only an unreachable endpoint rejects, which is what the Java side reads as a
// transport failure rather than as a refusal by the token endpoint.
function httpSendVia(transport: ProxiedFetchOpts): (requestJson: string) => Promise<string> {
  return async (requestJson: string): Promise<string> => {
    const request: HttpSendRequest = JSON.parse(requestJson);
    const { response, transportFailed } = await proxiedFetch(
      request.url,
      { method: request.method, headers: request.headers, body: request.body || undefined },
      transport,
    );
    if (transportFailed || !response) throw new Error("the token endpoint could not be reached");
    const headers: Record<string, string> = {};
    for (const [name, value] of response.headers) headers[name] = value;
    return JSON.stringify({ status: response.status, headers, body: await response.text() });
  };
}

/** Endpoint and client credentials {@link refreshAccessToken} needs to exchange a refresh token. */
export interface RefreshAccessTokenOpts {
  /** The token endpoint. */
  tokenUrl: string;
  /** OAuth client id. */
  clientId: string;
  /** OAuth client secret, when the client is confidential rather than public PKCE. */
  clientSecret?: string;
  /** Extra params to include in the refresh request body. */
  extraParams?: Record<string, string>;
  /** A proxy URL to route the refresh request through. */
  proxy?: string;
}

/** The token fields an endpoint returned; a member absent from the response is left `undefined`. */
export interface RefreshedToken {
  /** The new access token. */
  access?: string;
  /** Epoch ms. */
  expires?: number;
  /** A new refresh token, when the endpoint rotated it. */
  refresh?: string;
}

interface RefreshTokenResult {
  failed?: { message: string; revoked?: boolean; code?: string; description?: string; status?: number };
  access?: string;
  expires?: number;
  refresh?: string;
}

/**
 * Exchanges a refresh token for a new access token.
 *
 * @param transport `net.ts`'s `ProxiedFetchOpts`; passing `{ proxyManager, accountId, providerId }`
 * binds the refresh to the account's sticky proxy, so upstream sees one IP for a refresh and for
 * the requests it authorizes.
 * @returns `undefined` if `refreshToken` is empty
 * @throws {TokenRefreshError} if the endpoint refuses the refresh or cannot be reached
 */
export async function refreshAccessToken(
  refreshToken: string,
  opts: RefreshAccessTokenOpts,
  transport: ProxiedFetchOpts = {},
): Promise<RefreshedToken | undefined> {
  if (!refreshToken) return undefined;
  const config = JSON.stringify({
    tokenUrl: opts.tokenUrl,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    extraParams: opts.extraParams,
  });
  const via: ProxiedFetchOpts = opts.proxy && !transport.proxy ? { ...transport, proxy: opts.proxy } : transport;

  let raw: string;
  try {
    raw = await getCoreAuth().refreshToken(refreshToken, config, httpSendVia(via));
  } catch (error) {
    throw new TokenRefreshError({ message: error instanceof Error ? error.message : String(error) });
  }

  const result: RefreshTokenResult = JSON.parse(raw);
  if (result.failed) {
    throw new TokenRefreshError({
      message: result.failed.message,
      // Restated as the code, so `revoked` keeps deriving from one place rather than two.
      code: result.failed.revoked ? "invalid_grant" : result.failed.code,
      description: result.failed.description,
      status: result.failed.status,
    });
  }
  return { access: result.access, expires: result.expires, refresh: result.refresh };
}
