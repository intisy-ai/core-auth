package io.github.intisy.ai.shared.oauth;

import io.github.intisy.ai.api.seam.HttpClient;
import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.api.seam.HttpRequest;
import io.github.intisy.ai.api.seam.HttpResponse;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Non-interactive OAuth {@code authorization_code} exchange - the login counterpart to
 * {@link TokenRefresh}'s {@code refresh_token} grant, on the same {@link HttpClient}/{@link JsonCodec}
 * SPIs so it stays transpilable. Given the {@code code} an authorize redirect delivered (plus the
 * PKCE {@code code_verifier} and the {@code redirect_uri} used at authorize time), it returns the
 * initial {@link Refreshed} token set. {@code now} is passed in explicitly for deterministic expiry.
 *
 * <p>The form encoding, error parsing and expiry maths it shares with {@link TokenRefresh} live in
 * {@link OAuthWire}; what stays here is the JSON request body, which only this grant sends.
 */
public final class OAuthExchange {

    private OAuthExchange() {
    }

    /**
     * @param code the authorization code an authorize redirect delivered
     * @param codeVerifier the PKCE verifier matching the challenge sent at authorize time, or
     *                      {@code null} when the flow does not use PKCE
     * @param redirectUri the redirect URI used at authorize time, or {@code null} to omit it
     * @param cfg the OAuth endpoint and client configuration to use
     * @param jsonBody whether to send the grant as a JSON body instead of form-urlencoded
     * @param http the HTTP client used to make the request
     * @param json the codec used to parse the token endpoint's response
     * @param now the current epoch ms, used to compute the new token's expiry
     * @return the initial access/expires/refresh token set
     */
    public static Refreshed exchangeCode(String code, String codeVerifier, String redirectUri,
                                         OAuthConfig cfg, boolean jsonBody,
                                         HttpClient http, JsonCodec json, long now) {
        Map<String, String> params = new LinkedHashMap<>();
        params.put("grant_type", "authorization_code");
        params.put("code", code);
        if (redirectUri != null) params.put("redirect_uri", redirectUri);
        params.put("client_id", cfg.clientId);
        if (cfg.clientSecret != null) params.put("client_secret", cfg.clientSecret);
        if (codeVerifier != null) params.put("code_verifier", codeVerifier);
        if (cfg.extraParams != null) params.putAll(cfg.extraParams);

        HttpRequest request = new HttpRequest();
        request.method = "POST";
        request.url = cfg.tokenUrl;
        request.headers = new LinkedHashMap<>();
        if (jsonBody) {
            request.headers.put("content-type", "application/json");
            request.body = jsonEncode(params);
        } else {
            request.headers.put("content-type", "application/x-www-form-urlencoded");
            request.body = OAuthWire.formEncode(params);
        }

        HttpResponse response;
        try {
            response = http.send(request);
        } catch (Exception e) {
            throw new TokenRefreshError("OAuth code exchange request failed: " + e.getMessage(), e);
        }

        if (response.status < 200 || response.status >= 300) {
            OAuthWire.OAuthError parsed = OAuthWire.parseOAuthError(response.body, json);
            boolean revoked = "invalid_grant".equals(parsed.code);
            String details = OAuthWire.joinNonNull(parsed.code, parsed.description);
            String base = "OAuth code exchange failed (" + response.status + ")";
            String message = details != null ? base + " - " + details : base;
            throw new TokenRefreshError(message, revoked, response.status, parsed.code, parsed.description);
        }

        Map<String, Object> payload;
        try {
            Map<String, Object> parsed = OAuthWire.asMap(json.parse(response.body == null ? "" : response.body));
            if (parsed == null) throw new IllegalArgumentException("response body is not a JSON object");
            payload = parsed;
        } catch (Exception e) {
            throw new TokenRefreshError("OAuth code exchange returned an unparseable body: " + response.body, e);
        }
        String access = OAuthWire.stringField(payload, "access_token");
        Double expiresIn = OAuthWire.numberField(payload, "expires_in");
        String refresh = OAuthWire.stringField(payload, "refresh_token");
        return new Refreshed(access, OAuthWire.calculateTokenExpiry(now, expiresIn), refresh);
    }

    private static String jsonEncode(Map<String, String> params) {
        StringBuilder sb = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, String> e : params.entrySet()) {
            if (!first) sb.append(',');
            first = false;
            sb.append(jsonString(e.getKey())).append(':').append(jsonString(e.getValue()));
        }
        return sb.append('}').toString();
    }

    private static String jsonString(String value) {
        if (value == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        sb.append("\\u");
                        String hex = Integer.toHexString(c);
                        for (int p = hex.length(); p < 4; p++) sb.append('0');
                        sb.append(hex);
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.append('"').toString();
    }

}
