package io.github.intisy.ai.shared.oauth;

import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.seam.SimpleJsonCodec;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OAuthWireStateTest {

    private static final JsonCodec JSON = new SimpleJsonCodec();

    private static Map<String, Object> callback(String code, String state) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("code", code);
        out.put("state", state);
        return out;
    }

    @Test
    void readsCodeAndStateFromAFullRedirectUrl() {
        assertEquals(callback("abc123", "xyz789"),
                OAuthWire.parsePastedCallback("http://localhost:51121/callback?code=abc123&state=xyz789"));
    }

    @Test
    void percentDecodesCodeAndState() {
        assertEquals(callback("a/b", "s=1"),
                OAuthWire.parsePastedCallback("http://localhost/callback?code=a%2Fb&state=s%3D1"));
    }

    /** URLDecoder would turn this into a space, which would corrupt a code that legitimately holds '+'. */
    @Test
    void keepsAPlusVerbatimRatherThanReadingItAsASpace() {
        assertEquals("a+b", OAuthWire.percentDecode("a+b"));
        assertEquals("a b", OAuthWire.percentDecode("a%20b"));
    }

    // The expected character is written as an escape so the assertion does not depend on which
    // encoding javac happens to read this file with.
    @Test
    void decodesMultiByteUtf8Escapes() {
        assertEquals("\u00e4", OAuthWire.percentDecode("%C3%A4"));
        assertEquals("\u20ac", OAuthWire.percentDecode("%E2%82%AC"));
    }

    @Test
    void leavesAStrayPercentAlone() {
        assertEquals("100%", OAuthWire.percentDecode("100%"));
        assertEquals("a%zz", OAuthWire.percentDecode("a%zz"));
    }

    @Test
    void toleratesAUrlWithNoStateParam() {
        assertEquals(callback("abc123", null),
                OAuthWire.parsePastedCallback("http://localhost/callback?code=abc123"));
    }

    @Test
    void readsABareCodeHashStatePair() {
        assertEquals(callback("abc123", "xyz789"), OAuthWire.parsePastedCallback("abc123#xyz789"));
        assertEquals(callback("abc123", null), OAuthWire.parsePastedCallback("abc123#"));
    }

    /** A second '#' belongs to neither field, matching the two-way split the drivers already relied on. */
    @Test
    void takesOnlyTheFirstTwoSegmentsOfAMultiHashPaste() {
        assertEquals(callback("a", "b"), OAuthWire.parsePastedCallback("a#b#c"));
    }

    @Test
    void treatsABareCodeAsCodeOnly() {
        assertEquals(callback("just-a-bare-code", null), OAuthWire.parsePastedCallback("just-a-bare-code"));
    }

    @Test
    void trimsSurroundingWhitespace() {
        assertEquals(callback("abc123", null), OAuthWire.parsePastedCallback("  abc123  \n"));
    }

    @Test
    void reportsNothingPastedAsNull() {
        assertNull(OAuthWire.parsePastedCallback(""));
        assertNull(OAuthWire.parsePastedCallback("   "));
        assertNull(OAuthWire.parsePastedCallback(null));
    }

    @Test
    void stateRoundTripsThroughUrlSafeBase64() {
        String payload = "{\"verifier\":\"abc\",\"foo\":\"bar\"}";
        assertEquals(payload, OAuthWire.decodeState(OAuthWire.encodeState(payload), JSON));
    }

    /** Unpadded, because a '=' would have to be escaped again to survive the redirect. */
    @Test
    void encodesWithoutPaddingAndWithoutUrlUnsafeCharacters() {
        String encoded = OAuthWire.encodeState("{\"verifier\":\"aa\"}");
        assertTrue(encoded.indexOf('=') < 0, encoded);
        assertTrue(encoded.indexOf('+') < 0, encoded);
        assertTrue(encoded.indexOf('/') < 0, encoded);
    }

    @Test
    void refusesAStateCarryingNoPkceVerifier() {
        String encoded = OAuthWire.encodeState("{\"foo\":\"bar\"}");
        IllegalArgumentException thrown =
                assertThrows(IllegalArgumentException.class, () -> OAuthWire.decodeState(encoded, JSON));
        assertEquals("Missing PKCE verifier in state", thrown.getMessage());
    }

    @Test
    void refusesAVerifierThatIsNotAString() {
        String encoded = OAuthWire.encodeState("{\"verifier\":42}");
        assertThrows(IllegalArgumentException.class, () -> OAuthWire.decodeState(encoded, JSON));
    }
}
