package io.github.intisy.ai.shared.chat;

import io.github.intisy.ai.api.seam.JsonCodec;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Shapes a TERMINAL provider failure so a host surfaces it in the chat instead of retrying forever.
 *
 * <p>Both hosts retry the transient upstream statuses (429 rate_limit, 500 api_error, 503, 529
 * overloaded), so returning one of those for a permanent condition (every account spent for hours,
 * broken auth, no accounts at all) makes the client retry endlessly. A 400 invalid_request_error, or
 * a 401/403, is shown to the user and not retried.
 *
 * @implNote the body has to match what the host's own SDK parses or it is dumped raw: the Anthropic
 * path wants {@code {type:"error", error:{type, message}}} and the Gemini path wants
 * {@code {error:{code, message, status}}}. A provider on the Gemini path asks for that shape, and
 * its Anthropic bridge converts back by recognising the {@code x-hub-chat-error} marker, so both
 * hosts render a clean message rather than raw JSON.
 */
public final class ChatError {
    private static final long DEFAULT_STATUS = 400;
    private static final String DEFAULT_TYPE = "invalid_request_error";
    private static final String GEMINI = "gemini";

    private ChatError() {
    }

    /**
     * The response to send, as {@code {status, body, headers}}. {@code opts} carries the optional
     * {@code format}, {@code status}, {@code type}, {@code geminiStatus}, {@code rateLimited} and
     * {@code retryAfterMs}.
     *
     * @param message the user-facing error message
     * @param opts the shaping options, or {@code null} to use every default
     * @param json the codec used to serialize the response body
     * @return the response to send, as {@code {status, body, headers}}
     */
    public static Map<String, Object> build(String message, Map<String, Object> opts, JsonCodec json) {
        Map<String, Object> options = opts == null ? new LinkedHashMap<String, Object>() : opts;
        long status = numberOr(options.get("status"), DEFAULT_STATUS);

        Map<String, Object> response = new LinkedHashMap<String, Object>();
        response.put("status", Long.valueOf(status));
        response.put("body", json.stringify(payload(message, options, status)));
        response.put("headers", headers(options));
        return response;
    }

    private static Map<String, Object> payload(String message, Map<String, Object> options, long status) {
        Map<String, Object> error = new LinkedHashMap<String, Object>();
        Map<String, Object> payload = new LinkedHashMap<String, Object>();

        if (GEMINI.equals(text(options.get("format")))) {
            error.put("code", Long.valueOf(status));
            error.put("message", message);
            error.put("status", firstNonEmpty(text(options.get("geminiStatus")),
                    status == 429 ? "RESOURCE_EXHAUSTED" : "INVALID_ARGUMENT"));
            payload.put("error", error);
            return payload;
        }

        error.put("type", firstNonEmpty(text(options.get("type")), DEFAULT_TYPE));
        error.put("message", message);
        payload.put("type", "error");
        payload.put("error", error);
        return payload;
    }

    /**
     * The rate-limit marker lets a loader proxy advance to the next fallback model instead of
     * treating this as terminal, and the reset it carries keeps the final all-fallbacks-exhausted
     * message consistent across providers.
     */
    private static Map<String, Object> headers(Map<String, Object> options) {
        Map<String, Object> headers = new LinkedHashMap<String, Object>();
        headers.put("content-type", "application/json");
        headers.put("x-hub-chat-error", "1");

        if (!Boolean.TRUE.equals(options.get("rateLimited"))) return headers;
        headers.put("x-hub-rate-limited", "1");
        Object retryAfterMs = options.get("retryAfterMs");
        if (retryAfterMs instanceof Number) {
            double ms = ((Number) retryAfterMs).doubleValue();
            if (ms > 0) headers.put("x-hub-retry-after-ms", String.valueOf(Math.round(ms)));
        }
        return headers;
    }

    private static long numberOr(Object value, long fallback) {
        return value instanceof Number ? ((Number) value).longValue() : fallback;
    }

    private static String text(Object value) {
        return value instanceof String ? (String) value : null;
    }

    private static String firstNonEmpty(String preferred, String fallback) {
        return preferred != null && !preferred.isEmpty() ? preferred : fallback;
    }
}
