package io.github.intisy.ai.shared.chat;

import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.seam.SimpleJsonCodec;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ChatErrorTest {

    private static final JsonCodec JSON = new SimpleJsonCodec();

    private static Map<String, Object> opts(Object... pairs) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) out.put((String) pairs[i], pairs[i + 1]);
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> headersOf(Map<String, Object> response) {
        return (Map<String, Object>) response.get("headers");
    }

    @Test
    void defaultsToATerminalAnthropicShapedBadRequest() {
        Map<String, Object> response = ChatError.build("all spent", null, JSON);

        assertEquals(Long.valueOf(400), response.get("status"));
        assertEquals("{\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"all spent\"}}",
                response.get("body"));
    }

    @Test
    void carriesTheCallersStatusAndErrorType() {
        Map<String, Object> response =
                ChatError.build("run cc auth", opts("type", "authentication_error", "status", Long.valueOf(401)), JSON);

        assertEquals(Long.valueOf(401), response.get("status"));
        assertEquals("{\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"run cc auth\"}}",
                response.get("body"));
    }

    @Test
    void emitsTheGeminiShapeForAProviderOnThatPath() {
        Map<String, Object> response = ChatError.build("pool exhausted", opts("format", "gemini"), JSON);

        assertEquals("{\"error\":{\"code\":400,\"message\":\"pool exhausted\",\"status\":\"INVALID_ARGUMENT\"}}",
                response.get("body"));
    }

    @Test
    void aGemini429ReportsResourceExhausted() {
        Map<String, Object> response =
                ChatError.build("slow down", opts("format", "gemini", "status", Long.valueOf(429)), JSON);

        assertEquals("{\"error\":{\"code\":429,\"message\":\"slow down\",\"status\":\"RESOURCE_EXHAUSTED\"}}",
                response.get("body"));
    }

    @Test
    void anExplicitGeminiStatusWins() {
        Map<String, Object> response = ChatError.build("nope",
                opts("format", "gemini", "status", Long.valueOf(429), "geminiStatus", "UNAVAILABLE"), JSON);

        assertTrue(((String) response.get("body")).contains("\"status\":\"UNAVAILABLE\""));
    }

    @Test
    void alwaysMarksTheBodyAsAChatError() {
        Map<String, Object> headers = headersOf(ChatError.build("x", null, JSON));

        assertEquals("application/json", headers.get("content-type"));
        assertEquals("1", headers.get("x-hub-chat-error"));
        assertFalse(headers.containsKey("x-hub-rate-limited"));
    }

    @Test
    void marksRateLimitExhaustionAndCarriesTheReset() {
        Map<String, Object> headers = headersOf(ChatError.build("wait",
                opts("rateLimited", Boolean.TRUE, "retryAfterMs", Double.valueOf(1500.6)), JSON));

        assertEquals("1", headers.get("x-hub-rate-limited"));
        assertEquals("1501", headers.get("x-hub-retry-after-ms"));
    }

    /** A reset that has already passed carries no header, so a proxy does not wait on a stale value. */
    @Test
    void omitsANonPositiveOrAbsentReset() {
        assertFalse(headersOf(ChatError.build("wait", opts("rateLimited", Boolean.TRUE), JSON))
                .containsKey("x-hub-retry-after-ms"));
        assertFalse(headersOf(ChatError.build("wait",
                opts("rateLimited", Boolean.TRUE, "retryAfterMs", Long.valueOf(0)), JSON))
                .containsKey("x-hub-retry-after-ms"));
    }
}
