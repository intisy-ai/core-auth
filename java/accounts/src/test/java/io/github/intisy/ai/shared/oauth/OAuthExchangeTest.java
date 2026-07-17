package io.github.intisy.ai.shared.oauth;

import io.github.intisy.ai.shared.spi.HttpClient;
import io.github.intisy.ai.shared.spi.JsonCodec;
import io.github.intisy.ai.shared.spi.http.HttpRequest;
import io.github.intisy.ai.shared.spi.http.HttpResponse;
import io.github.intisy.ai.shared.store.TestJsonCodec;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OAuthExchangeTest {

    // Reuse the hermetic TestJsonCodec double from the store tests rather than a real
    // gson-backed impl (:accounts must not drag in :jvm) or a new inner class.
    private static final JsonCodec JSON = new TestJsonCodec();

    private static final class Captor implements HttpClient {
        HttpRequest last;
        int status = 200;
        String body = "{\"access_token\":\"at\",\"refresh_token\":\"rt2\",\"expires_in\":3600}";
        @Override public HttpResponse send(HttpRequest req) {
            this.last = req;
            HttpResponse r = new HttpResponse();
            r.status = status;
            r.headers = new LinkedHashMap<>();
            r.body = body;
            return r;
        }
    }

    @Test
    void formExchangeSendsAuthorizationCodeGrant() {
        Captor http = new Captor();
        OAuthConfig cfg = new OAuthConfig();
        cfg.tokenUrl = "https://token.example/oauth/token";
        cfg.clientId = "client-123";

        Refreshed r = OAuthExchange.exchangeCode("the-code", "the-verifier",
                "https://app.example/api/oauth/callback", cfg, false, http, JSON, 1000L);

        assertEquals("at", r.access);
        assertEquals("rt2", r.refresh);
        assertEquals(1000L + 3600_000L, r.expires);
        assertTrue(http.last.body.contains("grant_type=authorization_code"), http.last.body);
        assertTrue(http.last.body.contains("code=the-code"), http.last.body);
        assertTrue(http.last.body.contains("code_verifier=the-verifier"), http.last.body);
        assertTrue(http.last.body.contains("client_id=client-123"), http.last.body);
        assertEquals("application/x-www-form-urlencoded", http.last.headers.get("content-type"));
    }

    @Test
    void jsonExchangeSendsJsonBody() {
        Captor http = new Captor();
        OAuthConfig cfg = new OAuthConfig();
        cfg.tokenUrl = "https://token.example/oauth/token";
        cfg.clientId = "client-123";

        Refreshed r = OAuthExchange.exchangeCode("c", "v", "https://app/cb", cfg, true, http, JSON, 0L);
        assertNotNull(r.access);
        assertEquals("application/json", http.last.headers.get("content-type"));
        assertTrue(http.last.body.contains("\"grant_type\""), http.last.body);
        assertTrue(http.last.body.contains("authorization_code"), http.last.body);
    }

    @Test
    void non2xxThrows() {
        Captor http = new Captor();
        http.status = 400;
        http.body = "{\"error\":\"invalid_grant\"}";
        OAuthConfig cfg = new OAuthConfig();
        cfg.tokenUrl = "https://token.example/oauth/token";
        cfg.clientId = "client-123";
        TokenRefreshError e = assertThrows(TokenRefreshError.class,
                () -> OAuthExchange.exchangeCode("c", "v", "cb", cfg, false, http, JSON, 0L));
        assertTrue(e.getMessage().contains("400"), e.getMessage());
    }
}
