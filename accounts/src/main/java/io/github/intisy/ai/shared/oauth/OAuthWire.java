package io.github.intisy.ai.shared.oauth;

import io.github.intisy.ai.api.seam.JsonCodec;

import java.io.UnsupportedEncodingException;
import java.util.Map;

/**
 * The wire encoding and error parsing both OAuth grants share: {@link TokenRefresh}'s
 * {@code refresh_token} and {@link OAuthExchange}'s {@code authorization_code}.
 *
 * @implNote public rather than package-private only because the TeaVM export surface that hands
 * {@link #calculateTokenExpiry} to TypeScript lives in another package. Nothing here is a stable
 * contract for an outside caller.
 */
public final class OAuthWire {

    private OAuthWire() {
    }

    /** Defaults to 3600s; a non-positive or non-numeric value collapses to {@code requestTimeMs}. */
    public static long calculateTokenExpiry(long requestTimeMs, Double expiresInSeconds) {
        double seconds = expiresInSeconds != null ? expiresInSeconds : 3600;
        if (Double.isNaN(seconds) || seconds <= 0) return requestTimeMs;
        return requestTimeMs + (long) (seconds * 1000);
    }

    /** application/x-www-form-urlencoded body. No {@code java.net.URLEncoder} (transpilability). */
    static String formEncode(Map<String, String> params) {
        StringBuilder sb = new StringBuilder();
        boolean first = true;
        for (Map.Entry<String, String> e : params.entrySet()) {
            if (!first) sb.append('&');
            first = false;
            sb.append(percentEncode(e.getKey())).append('=').append(percentEncode(e.getValue()));
        }
        return sb.toString();
    }

    /** RFC 3986 unreserved chars pass through; space becomes {@code '+'}; everything else is percent-escaped UTF-8 bytes. */
    static String percentEncode(String s) {
        if (s == null) return "";
        byte[] bytes;
        try {
            bytes = s.getBytes("UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e); // UTF-8 is always supported
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
    static Map<String, Object> asMap(Object o) {
        return o instanceof Map ? (Map<String, Object>) o : null;
    }

    static String stringField(Map<String, Object> obj, String field) {
        Object v = obj.get(field);
        return v instanceof String ? (String) v : null;
    }

    /** A non-numeric value (e.g. a string) falls back to {@code null} rather than throwing. */
    static Double numberField(Map<String, Object> obj, String field) {
        Object v = obj.get(field);
        return v instanceof Number ? ((Number) v).doubleValue() : null;
    }

    static String joinNonNull(String a, String b) {
        if (a == null) return b;
        if (b == null) return a;
        return a + ": " + b;
    }

    static final class OAuthError {
        final String code;
        final String description;

        OAuthError(String code, String description) {
            this.code = code;
            this.description = description;
        }
    }

    /** Tolerates the varied error-body shapes OAuth token endpoints return. */
    static OAuthError parseOAuthError(String text, JsonCodec json) {
        if (text == null || text.isEmpty()) return new OAuthError(null, null);
        try {
            Map<String, Object> payload = asMap(json.parse(text));
            if (payload == null) return new OAuthError(null, text);
            Object errorEl = payload.get("error");
            String code = null;
            if (errorEl instanceof String) {
                code = (String) errorEl;
            } else if (errorEl instanceof Map) {
                Map<String, Object> errObj = asMap(errorEl);
                code = stringField(errObj, "status");
                if (code == null) code = stringField(errObj, "code");
                if (payload.get("error_description") == null) {
                    String msg = stringField(errObj, "message");
                    if (msg != null) return new OAuthError(code, msg);
                }
            }
            String errorDescription = stringField(payload, "error_description");
            if (errorDescription != null) return new OAuthError(code, errorDescription);
            return new OAuthError(code, null);
        } catch (Exception e) {
            return new OAuthError(null, text);
        }
    }
}
