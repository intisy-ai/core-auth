package io.github.intisy.ai.shared.oauth;

import io.github.intisy.ai.api.seam.JsonCodec;

import java.io.ByteArrayOutputStream;
import java.io.UnsupportedEncodingException;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The wire encoding and error parsing both OAuth grants share: {@link TokenRefresh}'s
 * {@code refresh_token} and {@link OAuthExchange}'s {@code authorization_code}.
 *
 * @implNote public rather than package-private only because the TeaVM export surface that hands
 * {@link #calculateTokenExpiry} to TypeScript lives in another package. Nothing here is a stable
 * contract for an outside caller.
 */
public final class OAuthWire {

    private static final Pattern CALLBACK_CODE = Pattern.compile("[?&]code=([^&\\s]+)");
    private static final Pattern CALLBACK_STATE = Pattern.compile("[?&]state=([^&\\s]+)");

    private OAuthWire() {
    }

    /**
     * Defaults to 3600s; a non-positive or non-numeric value collapses to {@code requestTimeMs}.
     *
     * @param requestTimeMs the epoch ms the token request was made at
     * @param expiresInSeconds the grant's reported lifetime, or {@code null} to use the default
     * @return the epoch ms the token expires at
     */
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

    /**
     * Percent-decodes a query-parameter value the way {@code decodeURIComponent} does, over UTF-8
     * bytes. Deliberately NOT {@code java.net.URLDecoder}: that is untranspilable here, and it also
     * turns {@code '+'} into a space, which a code or state value must keep verbatim.
     */
    static String percentDecode(String s) {
        if (s == null) return "";
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '%' && i + 2 < s.length()) {
                try {
                    bytes.write(Integer.parseInt(s.substring(i + 1, i + 3), 16));
                    i += 2;
                    continue;
                } catch (NumberFormatException e) {
                    // Not an escape after all, so the '%' is a literal.
                }
            }
            byte[] encoded;
            try {
                encoded = String.valueOf(c).getBytes("UTF-8");
            } catch (UnsupportedEncodingException e) {
                throw new IllegalStateException(e); // UTF-8 is always supported
            }
            bytes.write(encoded, 0, encoded.length);
        }
        try {
            return new String(bytes.toByteArray(), "UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e); // UTF-8 is always supported
        }
    }

    /**
     * Reads a pasted OAuth callback in any of the shapes a driver sees: a full redirect URL, a bare
     * {@code code#state} pair, or a code alone. Returns {@code {code, state}} with a null state when
     * none was pasted, or null when nothing was.
     *
     * @param input the pasted redirect URL, {@code code#state} pair, or bare code
     * @return {@code {code, state}}, or {@code null} when {@code input} is blank
     */
    public static Map<String, Object> parsePastedCallback(String input) {
        String text = input == null ? "" : input.trim();
        if (text.isEmpty()) return null;

        Map<String, Object> parsed = new LinkedHashMap<String, Object>();
        Matcher code = CALLBACK_CODE.matcher(text);
        if (code.find()) {
            Matcher state = CALLBACK_STATE.matcher(text);
            parsed.put("code", percentDecode(code.group(1)));
            parsed.put("state", state.find() ? percentDecode(state.group(1)) : null);
            return parsed;
        }

        int hash = text.indexOf('#');
        if (hash >= 0) {
            String rest = text.substring(hash + 1);
            int next = rest.indexOf('#');
            String state = (next >= 0 ? rest.substring(0, next) : rest).trim();
            parsed.put("code", text.substring(0, hash).trim());
            parsed.put("state", state.isEmpty() ? null : state);
            return parsed;
        }

        parsed.put("code", text);
        parsed.put("state", null);
        return parsed;
    }

    /**
     * Packs an already-serialised OAuth {@code state} payload as unpadded URL-safe base64, so it
     * survives a redirect round trip. The caller serialises, so the encoded bytes are exactly the
     * JSON it produced.
     *
     * @param payloadJson the already-serialised state payload
     * @return the unpadded URL-safe base64 encoding of {@code payloadJson}
     */
    public static String encodeState(String payloadJson) {
        byte[] bytes;
        try {
            bytes = (payloadJson == null ? "" : payloadJson).getBytes("UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e); // UTF-8 is always supported
        }
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * Unpacks a {@code state} produced by {@link #encodeState} and asserts it still carries the PKCE
     * verifier. Returns the decoded JSON text, so the caller parses exactly the bytes that were
     * encoded rather than a re-serialisation of them.
     *
     * @param state the base64 state produced by {@link #encodeState}
     * @param json the codec used to parse the decoded payload
     * @return the decoded JSON text
     * @throws IllegalArgumentException when the payload carries no string {@code verifier}
     */
    public static String decodeState(String state, JsonCodec json) {
        String padded = state == null ? "" : state;
        int remainder = padded.length() % 4;
        if (remainder != 0) padded = padded + "====".substring(remainder);

        String decoded;
        try {
            decoded = new String(Base64.getUrlDecoder().decode(padded), "UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException(e); // UTF-8 is always supported
        }

        Map<String, Object> payload = asMap(json.parse(decoded));
        Object verifier = payload == null ? null : payload.get("verifier");
        if (!(verifier instanceof String)) throw new IllegalArgumentException("Missing PKCE verifier in state");
        return decoded;
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
