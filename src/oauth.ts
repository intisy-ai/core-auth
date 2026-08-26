// @ts-nocheck
// Generic OAuth helpers + token refresh; the driver supplies its own tokenUrl/clientId/clientSecret.
// The refresh call itself is single-sourced in Java (TokenRefresh, java/accounts) behind
// CoreAuthJs.refreshToken; what stays here is the transport it runs over and the error shape
// callers branch on.
import { getCoreAuth } from "./core-auth-loader.js";
import { proxiedFetch } from "./net.js";

export function isOAuthAuth(auth) {
  return !!auth && auth.type === "oauth";
}

// Delegates to CoreAuthJs.accessTokenExpired (TokenRefresh.accessTokenExpired, java/accounts),
// the single-sourced expired-or-missing predicate with the 60s clock-skew buffer.
export function accessTokenExpired(auth) {
  return getCoreAuth().accessTokenExpired(JSON.stringify(auth || {}), Date.now());
}

// Delegates to CoreAuthJs.calculateTokenExpiry (OAuthWire, java/accounts), which both OAuth grants
// use. A non-number crosses as NaN, which the engine reads as "the endpoint reported no expires_in".
export function calculateTokenExpiry(requestTimeMs, expiresInSeconds) {
  const seconds = typeof expiresInSeconds === "number" ? expiresInSeconds : NaN;
  return getCoreAuth().calculateTokenExpiry(requestTimeMs, seconds);
}

// Packs an OAuth `state` param as URL-safe base64 so it survives a redirect roundtrip.
export function encodeState(payload) {
  return getCoreAuth().encodeState(JSON.stringify(payload));
}

// Unpacks a `state` param produced by encodeState and asserts the PKCE verifier is present.
export function decodeState(state) {
  const result = JSON.parse(getCoreAuth().decodeState(String(state)));
  if (result.error) throw new Error(result.error);
  return JSON.parse(result.payload);
}

export class TokenRefreshError extends Error {
  constructor(options) {
    super(options.message);
    this.name = "TokenRefreshError";
    this.code = options.code;
    this.description = options.description;
    this.status = options.status;
    this.revoked = options.code === "invalid_grant";   // refresh token revoked -> reauth
  }
}

// A JSON transport for the Java refresh call, built on net.ts's proxy-aware fetch so a dead proxy
// falls back to a direct attempt in the ONE place that mechanic lives. Any reported status comes
// back as data; only an unreachable endpoint rejects, which is what the Java side reads as a
// transport failure rather than as a refusal by the token endpoint.
function httpSendVia(transport) {
  return async (requestJson) => {
    const request = JSON.parse(requestJson);
    const { response, transportFailed } = await proxiedFetch(
      request.url,
      { method: request.method, headers: request.headers, body: request.body || undefined },
      transport,
    );
    if (transportFailed || !response) throw new Error("the token endpoint could not be reached");
    const headers = {};
    for (const [name, value] of response.headers) headers[name] = value;
    return JSON.stringify({ status: response.status, headers, body: await response.text() });
  };
}

// opts: { tokenUrl, clientId, clientSecret?, extraParams?, proxy? }; returns { access, expires,
// refresh } or throws TokenRefreshError. `transport` is net.ts's ProxiedFetchOpts: passing
// { proxyManager, accountId, providerId } binds the refresh to the account's sticky proxy, so
// upstream sees one IP for a refresh and for the requests it authorizes.
export async function refreshAccessToken(refreshToken, opts, transport = {}) {
  if (!refreshToken) return undefined;
  const config = JSON.stringify({
    tokenUrl: opts.tokenUrl,
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    extraParams: opts.extraParams,
  });
  const via = opts.proxy && !transport.proxy ? { ...transport, proxy: opts.proxy } : transport;

  let raw;
  try {
    raw = await getCoreAuth().refreshToken(refreshToken, config, httpSendVia(via));
  } catch (error) {
    throw new TokenRefreshError({ message: String((error && error.message) || error) });
  }

  const result = JSON.parse(raw);
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
