// @ts-nocheck
// Generic OAuth helpers + token refresh; the driver supplies its own tokenUrl/clientId/clientSecret.

const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

export function isOAuthAuth(auth) {
  return !!auth && auth.type === "oauth";
}

// expired or missing, with a buffer for clock skew
export function accessTokenExpired(auth) {
  if (!auth || !auth.access || typeof auth.expires !== "number") return true;
  return auth.expires <= Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS;
}

export function calculateTokenExpiry(requestTimeMs, expiresInSeconds) {
  const seconds = typeof expiresInSeconds === "number" ? expiresInSeconds : 3600;
  if (isNaN(seconds) || seconds <= 0) return requestTimeMs;
  return requestTimeMs + seconds * 1000;
}

export class TokenRefreshError extends Error {
  constructor(options) {
    super(options.message);
    this.name = "TokenRefreshError";
    this.code = options.code;
    this.description = options.description;
    this.status = options.status;
    this.statusText = options.statusText;
    this.revoked = options.code === "invalid_grant";   // refresh token revoked -> reauth
  }
}

// tolerate the varied error shapes OAuth token endpoints return
function parseOAuthError(text) {
  if (!text) return {};
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object") return { description: text };
    let code;
    if (typeof payload.error === "string") code = payload.error;
    else if (payload.error && typeof payload.error === "object") {
      code = payload.error.status || payload.error.code;
      if (!payload.error_description && payload.error.message) return { code, description: payload.error.message };
    }
    if (payload.error_description) return { code, description: payload.error_description };
    if (payload.error && typeof payload.error === "object" && payload.error.message) return { code, description: payload.error.message };
    return { code };
  } catch { return { description: text }; }
}

// opts: { tokenUrl, clientId, clientSecret?, extraParams? }; returns { access, expires, refresh } or throws TokenRefreshError.
export async function refreshAccessToken(refreshToken, opts) {
  if (!refreshToken) return undefined;
  const startTime = Date.now();
  const params = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: opts.clientId,
  };
  if (opts.clientSecret) params.client_secret = opts.clientSecret;
  Object.assign(params, opts.extraParams || {});

  const init = {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  };
  if (opts.proxy) init.proxy = opts.proxy;   // Bun fetch honors .proxy; keeps refresh on the account's IP
  let response;
  try {
    response = await fetch(opts.tokenUrl, init);
  } catch (err) {
    // A dead/unreachable proxy must not strand the account on an expired token:
    // a token refresh that never reached the server can be safely retried direct.
    const message = String((err && err.message) || err);
    if (init.proxy && /unable to connect|failed to connect|could not connect|fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|EAI_AGAIN|socket|proxy|tunnel|network/i.test(message)) {
      delete init.proxy;
      response = await fetch(opts.tokenUrl, init);
    } else {
      throw err;
    }
  }

  if (!response.ok) {
    let errorText;
    try { errorText = await response.text(); } catch { errorText = undefined; }
    const { code, description } = parseOAuthError(errorText);
    const details = [code, description || errorText].filter(Boolean).join(": ");
    const base = "OAuth token refresh failed (" + response.status + " " + response.statusText + ")";
    throw new TokenRefreshError({
      message: details ? base + " - " + details : base,
      code, description: description || errorText,
      status: response.status, statusText: response.statusText,
    });
  }

  const payload = await response.json();
  return {
    access: payload.access_token,
    expires: calculateTokenExpiry(startTime, payload.expires_in),
    refresh: payload.refresh_token || refreshToken,
  };
}
