package io.github.intisy.ai.shared.oauth;

import io.github.intisy.ai.shared.spi.HttpClient;
import io.github.intisy.ai.shared.spi.JsonCodec;
import io.github.intisy.ai.shared.spi.http.HttpRequest;
import io.github.intisy.ai.shared.spi.http.HttpResponse;

import java.io.UnsupportedEncodingException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Non-interactive OAuth {@code authorization_code} exchange — the login counterpart to
 * {@link TokenRefresh}'s {@code refresh_token} grant, on the same {@link HttpClient}/{@link JsonCodec}
 * SPIs so it stays transpilable. Given the {@code code} an authorize redirect delivered (plus the
 * PKCE {@code code_verifier} and the {@code redirect_uri} used at authorize time), it returns the
 * initial {@link Refreshed} token set. {@code now} is passed in explicitly for deterministic expiry.
 *
 * <p>Intentionally carries its own form-encode/response-parse helpers rather than sharing
 * {@link TokenRefresh}'s (which is live-critical and left untouched); unifying the two is a later,
 * separately-consented change.
 */
public final class OAuthExchange {

    private OAuthExchange() {
    }

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
            request.body = formEncode(params);
        }

        HttpResponse response;
        try {
            response = http.send(request);
        } catch (Exception e) {
            throw new TokenRefreshError("OAuth code exchange request failed: " + e.getMessage(), e);
        }

        if (response.status < 200 || response.status >= 300) {
            String errCode = errorCode(response.body, json);
            boolean revoked = "invalid_grant".equals(errCode);
            String base = "OAuth code exchange failed (" + response.status + ")";
            String message = errCode != null ? base + " - " + errCode : base;
            throw new TokenRefreshError(message, revoked);
        }

        Map<String, Object> payload = asMap(json.parse(response.body == null ? "" : response.body));
        if (payload == null) {
            throw new TokenRefreshError("OAuth code exchange returned an unparseable body: " + response.body, false);
        }
        String access = stringField(payload, "access_token");
        Double expiresIn = numberField(payload, "expires_in");
        String refresh = stringField(payload, "refresh_token");
        return new Refreshed(access, calculateTokenExpiry(now, expiresIn), refresh);
    }

    private static long calculateTokenExpiry(long requestTimeMs, Double expiresInSeconds) {
        double seconds = expiresInSeconds != null ? expiresInSeconds : 3600;
        if (Double.isNaN(seconds) || seconds <= 0) return requestTimeMs;
        return requestTimeMs + (long) (seconds * 1000);
    }

    private static String formEncode(Map<String, String> params) {
        StringBuilder sb = new StringBuilder();
        boolean first = true;
        for (Map.Entry<String, String> e : params.entrySet()) {
            if (!first) sb.append('&');
            first = false;
            sb.append(percentEncode(e.getKey())).append('=').append(percentEncode(e.getValue()));
        }
        return sb.toString();
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

    private static String percentEncode(String s) {
        if (s == null) return "";
        byte[] bytes;
        try {
            bytes = s.getBytes("UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            int c = b & 0xFF;
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                    || c == '-' || c == '_' || c == '.' || c == '*') {
                sb.append((char) c);
            } else if (c == ' ') {
                sb.append('+');
            } else {
                sb.append('%');
                String hex = Integer.toHexString(c).toUpperCase();
                if (hex.length() < 2) sb.append('0');
                sb.append(hex);
            }
        }
        return sb.toString();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : null;
    }

    private static String stringField(Map<String, Object> obj, String field) {
        Object v = obj.get(field);
        return v instanceof String ? (String) v : null;
    }

    private static Double numberField(Map<String, Object> obj, String field) {
        Object v = obj.get(field);
        return v instanceof Number ? ((Number) v).doubleValue() : null;
    }

    private static String errorCode(String text, JsonCodec json) {
        if (text == null || text.isEmpty()) return null;
        try {
            Map<String, Object> payload = asMap(json.parse(text));
            if (payload == null) return null;
            Object err = payload.get("error");
            if (err instanceof String) return (String) err;
            if (err instanceof Map) {
                Object status = ((Map<?, ?>) err).get("status");
                if (status instanceof String) return (String) status;
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }
}
