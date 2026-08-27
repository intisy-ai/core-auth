package io.github.intisy.ai.shared.oauth;

import io.github.intisy.ai.shared.model.Account;
import io.github.intisy.ai.api.seam.HttpClient;
import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.api.seam.HttpRequest;
import io.github.intisy.ai.api.seam.HttpResponse;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Non-interactive OAuth token refresh, and the only implementation of it: {@code oauth.ts}'s
 * {@code accessTokenExpired} and {@code refreshAccessToken} both reach this class through the
 * TeaVM bundle. Built on the {@link HttpClient} + {@link JsonCodec} SPIs (no
 * {@code HttpURLConnection}/gson) so it stays transpilable. {@code now} is always passed in
 * explicitly (never read from the wall clock here) so callers and tests stay deterministic.
 */
public final class TokenRefresh {
    /** Matches JS {@code ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000}. */
    private static final long ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60_000L;

    private TokenRefresh() {
    }

    /**
     * Expired or missing, with a buffer for clock skew. Matches JS: {@code !auth.access} or
     * {@code typeof auth.expires !== "number"} short-circuits to "expired", else
     * {@code auth.expires <= now + BUFFER}.
     *
     * @param a the account to check
     * @param now the current epoch ms
     * @return {@code true} when the account has no usable access token
     */
    public static boolean accessTokenExpired(Account a, long now) {
        if (a == null || a.access == null || a.expires == null) return true;
        return a.expires <= now + ACCESS_TOKEN_EXPIRY_BUFFER_MS;
    }

    /**
     * POSTs {@code grant_type=refresh_token} (+ refresh_token, client_id, optional
     * client_secret/extraParams) form-urlencoded to {@code cfg.tokenUrl} via {@code http}.
     * Returns the new {access, expires, refresh} on success; throws {@link TokenRefreshError}
     * on a non-2xx response ({@code revoked=true} iff the token endpoint reported
     * {@code error=invalid_grant}).
     *
     * @param refreshToken the refresh token to exchange
     * @param cfg the OAuth endpoint and client configuration to use
     * @param http the HTTP client used to make the request
     * @param json the codec used to parse the token endpoint's response
     * @param now the current epoch ms, used to compute the new token's expiry
     * @return the refreshed access/expires/refresh triple, or {@code null} when {@code refreshToken} is null
     */
    public static Refreshed refresh(String refreshToken, OAuthConfig cfg, HttpClient http, JsonCodec json, long now) {
        if (refreshToken == null) return null;

        Map<String, String> params = new LinkedHashMap<>();
        params.put("grant_type", "refresh_token");
        params.put("refresh_token", refreshToken);
        params.put("client_id", cfg.clientId);
        if (cfg.clientSecret != null) params.put("client_secret", cfg.clientSecret);
        if (cfg.extraParams != null) params.putAll(cfg.extraParams);

        HttpRequest request = new HttpRequest();
        request.method = "POST";
        request.url = cfg.tokenUrl;
        request.headers = new LinkedHashMap<>();
        request.headers.put("content-type", "application/x-www-form-urlencoded");
        request.body = OAuthWire.formEncode(params);

        HttpResponse response;
        try {
            response = http.send(request);
        } catch (Exception e) {
            throw new TokenRefreshError("OAuth token refresh request failed: " + e.getMessage(), e);
        }

        if (response.status < 200 || response.status >= 300) {
            OAuthWire.OAuthError parsed = OAuthWire.parseOAuthError(response.body, json);
            boolean revoked = "invalid_grant".equals(parsed.code);
            String details = OAuthWire.joinNonNull(parsed.code, parsed.description != null ? parsed.description : response.body);
            String base = "OAuth token refresh failed (" + response.status + ")";
            String message = details != null ? base + " - " + details : base;
            throw new TokenRefreshError(message, revoked, response.status, parsed.code,
                    parsed.description != null ? parsed.description : response.body);
        }

        Map<String, Object> payload;
        try {
            Map<String, Object> parsed = OAuthWire.asMap(json.parse(response.body == null ? "" : response.body));
            if (parsed == null) throw new IllegalArgumentException("response body is not a JSON object");
            payload = parsed;
        } catch (Exception e) {
            throw new TokenRefreshError("OAuth token refresh returned an unparseable body: " + response.body, e);
        }

        String access = OAuthWire.stringField(payload, "access_token");
        Double expiresIn = OAuthWire.numberField(payload, "expires_in");
        String refresh = OAuthWire.stringField(payload, "refresh_token");

        return new Refreshed(access, OAuthWire.calculateTokenExpiry(now, expiresIn), refresh != null ? refresh : refreshToken);
    }
}
