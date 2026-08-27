// Generic OAuth helpers + token refresh; the driver supplies its own tokenUrl/clientId/clientSecret.
// The refresh call itself is single-sourced in Java (TokenRefresh, java/accounts) behind
// CoreAuthJs.refreshToken; what stays here is the transport it runs over and the error shape
// callers branch on.
import { getCoreAuth } from "./core-auth-loader.js";
import { proxiedFetch, type ProxiedFetchOpts } from "./net.js";
import type { CoreAccount } from "./types.js";

export function isOAuthAuth(auth: unknown): auth is { type: "oauth" } {
  return !!auth && typeof auth === "object" && (auth as { type?: unknown }).type === "oauth";
}

// Delegates to CoreAuthJs.accessTokenExpired (TokenRefresh.accessTokenExpired, java/accounts),
// the single-sourced expired-or-missing predicate with the 60s clock-skew buffer.
export function accessTokenExpired(auth: Pick<CoreAccount, "access" | "expires"> | null | undefined): boolean {
  return getCoreAuth().accessTokenExpired(JSON.stringify(auth || {}), Date.now());
}

// Delegates to CoreAuthJs.calculateTokenExpiry (OAuthWire, java/accounts), which both OAuth grants
// use. A non-number crosses as NaN, which the engine reads as "the endpoint reported no expires_in".
export function calculateTokenExpiry(requestTimeMs: number, expiresInSeconds: unknown): number {
  const seconds = typeof expiresInSeconds === "number" ? expiresInSeconds : NaN;
  return getCoreAuth().calculateTokenExpiry(requestTimeMs, seconds);
}

// Packs an OAuth `state` param as URL-safe base64 so it survives a redirect roundtrip.
export function encodeState(payload: unknown): string {
  return getCoreAuth().encodeState(JSON.stringify(payload));
}

interface DecodedState {
  error?: string;
  payload: string;
}

// Unpacks a `state` param produced by encodeState and asserts the PKCE verifier is present.
export function decodeState(state: unknown): unknown {
  const result: DecodedState = JSON.parse(getCoreAuth().decodeState(String(state)));
  if (result.error) throw new Error(result.error);
  return JSON.parse(result.payload);
}

export interface TokenRefreshErrorOptions {
  message: string;
  code?: string;
  description?: string;
  status?: number;
}

export class TokenRefreshError extends Error {
  readonly code?: string;
  readonly description?: string;
  readonly status?: number;
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

export interface RefreshAccessTokenOpts {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  extraParams?: Record<string, string>;
  proxy?: string;
}

export interface RefreshedToken {
  access?: string;
  expires?: number;
  refresh?: string;
}

interface RefreshTokenResult {
  failed?: { message: string; revoked?: boolean; code?: string; description?: string; status?: number };
  access?: string;
  expires?: number;
  refresh?: string;
}

// `transport` is net.ts's ProxiedFetchOpts: passing { proxyManager, accountId, providerId } binds
// the refresh to the account's sticky proxy, so upstream sees one IP for a refresh and for the
// requests it authorizes.
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
