package io.github.intisy.ai.shared.manager;

import io.github.intisy.ai.shared.select.Strategy;
import io.github.intisy.ai.shared.model.Account;
import io.github.intisy.ai.shared.oauth.OAuthConfig;
import io.github.intisy.ai.shared.oauth.Refreshed;
import io.github.intisy.ai.shared.oauth.TokenRefresh;
import io.github.intisy.ai.shared.oauth.TokenRefreshError;
import io.github.intisy.ai.api.seam.Clock;
import io.github.intisy.ai.api.seam.HttpClient;
import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.api.seam.Random;
import io.github.intisy.ai.api.seam.Store;
import io.github.intisy.ai.api.seam.HttpRequest;
import io.github.intisy.ai.api.seam.HttpResponse;
import io.github.intisy.ai.shared.store.AccountStore;
import io.github.intisy.ai.seam.InMemoryStore;
import io.github.intisy.ai.seam.SimpleJsonCodec;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link AccountManager}'s OAuth refresh and account-claim behaviour, rewired onto
 * the SPIs: a fake {@link HttpClient} (no network), an in-memory {@link Store}, a fixed
 * {@link Clock}, and a deterministic {@link Random} -- fully deterministic, no wall-clock or
 * real I/O.
 */
class AccountManagerTest {

    /** Injectable fake seam: records the last request and returns a canned response. */
    private static class FakeHttpClient implements HttpClient {
        int responseStatus = 200;
        String responseBody = "{}";
        HttpRequest lastRequest;
        int callCount = 0;

        @Override
        public HttpResponse send(HttpRequest req) {
            callCount++;
            lastRequest = req;
            HttpResponse resp = new HttpResponse();
            resp.status = responseStatus;
            resp.body = responseBody;
            return resp;
        }
    }

    /** Fixed wall clock: tests set {@code time} directly for full determinism. */
    private static class FixedClock implements Clock {
        long time;

        FixedClock(long time) {
            this.time = time;
        }

        @Override
        public long now() {
            return time;
        }
    }

    private static OAuthConfig oauthConfig() {
        OAuthConfig cfg = new OAuthConfig();
        cfg.tokenUrl = "https://example.com/token";
        cfg.clientId = "client-123";
        return cfg;
    }

    private static AccountManager manager(String providerId, AccountStore store, ManagerOptions opts,
                                           HttpClient http, Clock clock, Random random, JsonCodec json) {
        return new AccountManager(providerId, store, http, clock, random, json, opts);
    }

    // ---- TokenRefresh.accessTokenExpired ----------------------------------------------------

    @Test
    void accessTokenExpired_trueWhenWithinSixtySecondSkewBuffer() {
        long now = 1_000_000L;

        Account atEdge = new Account();
        atEdge.access = "tok";
        atEdge.expires = now + 60_000L; // exactly at the buffer -> still expired (<=)
        assertTrue(TokenRefresh.accessTokenExpired(atEdge, now));

        Account beyondEdge = new Account();
        beyondEdge.access = "tok";
        beyondEdge.expires = now + 60_001L;
        assertFalse(TokenRefresh.accessTokenExpired(beyondEdge, now));

        Account missingAccess = new Account();
        missingAccess.expires = now + 999_999L;
        assertTrue(TokenRefresh.accessTokenExpired(missingAccess, now));

        Account missingExpires = new Account();
        missingExpires.access = "tok";
        assertTrue(TokenRefresh.accessTokenExpired(missingExpires, now));
    }

    // ---- TokenRefresh.refresh ----------------------------------------------------------------

    @Test
    void refresh_postsGrantTypeRefreshTokenAndReturnsAccessExpires() {
        long now = 1_000_000L;
        FakeHttpClient fake = new FakeHttpClient();
        fake.responseStatus = 200;
        fake.responseBody = "{\"access_token\":\"new-access\",\"expires_in\":3600,\"refresh_token\":\"new-refresh\"}";
        JsonCodec json = new SimpleJsonCodec();

        Refreshed result = TokenRefresh.refresh("old-refresh", oauthConfig(), fake, json, now);

        assertEquals("new-access", result.access);
        assertEquals(now + 3_600_000L, result.expires);
        assertEquals("new-refresh", result.refresh);

        assertEquals("https://example.com/token", fake.lastRequest.url);
        assertEquals("POST", fake.lastRequest.method);
        assertEquals("application/x-www-form-urlencoded", fake.lastRequest.headers.get("content-type"));
        assertTrue(fake.lastRequest.body.contains("grant_type=refresh_token"));
        assertTrue(fake.lastRequest.body.contains("refresh_token=old-refresh"));
        assertTrue(fake.lastRequest.body.contains("client_id=client-123"));
    }

    @Test
    void refresh_missingRefreshTokenFallsBackToOldOne() {
        long now = 1_000_000L;
        FakeHttpClient fake = new FakeHttpClient();
        fake.responseBody = "{\"access_token\":\"new-access\",\"expires_in\":60}";

        Refreshed result = TokenRefresh.refresh("old-refresh", oauthConfig(), fake, new SimpleJsonCodec(), now);

        assertEquals("old-refresh", result.refresh); // JS: `refresh_token || refreshToken`
    }

    @Test
    void refresh_invalidGrantThrowsRevokedTokenRefreshError() {
        FakeHttpClient fake = new FakeHttpClient();
        fake.responseStatus = 400;
        fake.responseBody = "{\"error\":\"invalid_grant\"}";

        TokenRefreshError err = assertThrows(TokenRefreshError.class,
                () -> TokenRefresh.refresh("old-refresh", oauthConfig(), fake, new SimpleJsonCodec(), 1_000_000L));

        assertTrue(err.revoked);
    }

    @Test
    void refresh_otherErrorCodeIsNotRevoked() {
        FakeHttpClient fake = new FakeHttpClient();
        fake.responseStatus = 500;
        fake.responseBody = "{\"error\":\"server_error\"}";

        TokenRefreshError err = assertThrows(TokenRefreshError.class,
                () -> TokenRefresh.refresh("old-refresh", oauthConfig(), fake, new SimpleJsonCodec(), 1_000_000L));

        assertFalse(err.revoked);
    }

    // ---- AccountManager.acquire / ensureAccess -----------------------------------------------

    @Test
    void acquire_returnsEnabledAccountAndRefreshesExpiredTokenViaFakeHttpClient() {
        Store rawStore = new InMemoryStore();
        JsonCodec json = new SimpleJsonCodec();
        AccountStore store = new AccountStore(rawStore, json);

        Account account = new Account();
        account.id = "acc1";
        account.enabled = true;
        account.refresh = "old-refresh";
        account.access = "stale-access";
        account.expires = 0L; // already expired
        store.add("provider", account);

        FakeHttpClient fake = new FakeHttpClient();
        fake.responseBody = "{\"access_token\":\"fresh-access\",\"expires_in\":3600,\"refresh_token\":\"rotated-refresh\"}";

        ManagerOptions opts = new ManagerOptions();
        opts.oauth = oauthConfig();

        AccountManager manager = manager("provider", store, opts, fake, new FixedClock(1_000_000L), () -> 0.5, json);

        Acquired acquired = manager.acquire("messages");

        assertNotNull(acquired);
        assertEquals("acc1", acquired.account.id);
        assertEquals("fresh-access", acquired.access);
        assertEquals(1, fake.callCount); // the fake was actually called

        Account persisted = store.list("provider").get(0);
        assertEquals("fresh-access", persisted.access);
        assertEquals("rotated-refresh", persisted.refresh);
        assertNotNull(persisted.lastUsed); // claimed by acquire
    }

    // ---- AccountManager.selectAndClaim: select+claim without network refresh -----------------

    @Test
    void selectAndClaim_claimsWithoutTriggeringNetworkRefresh() {
        Store rawStore = new InMemoryStore();
        JsonCodec json = new SimpleJsonCodec();
        AccountStore store = new AccountStore(rawStore, json);

        Account account = new Account();
        account.id = "acc1";
        account.enabled = true;
        account.refresh = "old-refresh";
        account.access = "stale-access";
        account.expires = 0L; // already expired -- acquire() would refresh; selectAndClaim must not

        store.add("provider", account);

        FakeHttpClient fake = new FakeHttpClient();
        ManagerOptions opts = new ManagerOptions();
        opts.oauth = oauthConfig(); // present, so a call WOULD be able to refresh if this leaked through

        AccountManager manager = manager("provider", store, opts, fake, new FixedClock(1_000_000L), () -> 0.5, json);

        Acquired claimed = manager.selectAndClaim("messages");

        assertNotNull(claimed);
        assertEquals("acc1", claimed.account.id);
        assertEquals("stale-access", claimed.access); // returned AS-IS, not refreshed
        assertEquals(0, fake.callCount); // no network call made

        Account persisted = store.list("provider").get(0);
        assertEquals("stale-access", persisted.access); // untouched
        assertNotNull(persisted.lastUsed); // still claimed (lastUsed set)
    }

    @Test
    void selectAndClaim_returnsNullWhenPoolIsEmpty() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());
        AccountManager manager = manager("provider", store, new ManagerOptions(),
                new FakeHttpClient(), new FixedClock(1_000_000L), () -> 0.5, new SimpleJsonCodec());

        assertNull(manager.selectAndClaim("messages"));
    }

    @Test
    void acquire_returnsNullWhenPoolIsEmpty() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());
        AccountManager manager = manager("provider", store, new ManagerOptions(),
                new FakeHttpClient(), new FixedClock(1_000_000L), () -> 0.5, new SimpleJsonCodec());

        assertNull(manager.acquire("messages"));
    }

    @Test
    void ensureAccess_disablesAccountWhenRefreshTokenRevoked() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());

        Account account = new Account();
        account.id = "acc1";
        account.enabled = true;
        account.refresh = "old-refresh";
        account.expires = 0L;
        store.add("provider", account);

        FakeHttpClient fake = new FakeHttpClient();
        fake.responseStatus = 400;
        fake.responseBody = "{\"error\":\"invalid_grant\"}";

        ManagerOptions opts = new ManagerOptions();
        opts.oauth = oauthConfig();

        AccountManager manager = manager("provider", store, opts, fake, new FixedClock(1_000_000L), () -> 0.5, new SimpleJsonCodec());

        assertThrows(TokenRefreshError.class, () -> manager.ensureAccess("acc1"));

        Account persisted = store.list("provider").get(0);
        assertEquals(Boolean.FALSE, persisted.enabled);
        assertEquals("refresh token revoked", persisted.disabledReason);
    }

    // ---- AccountManager.reportRateLimit / reportError / reportSuccess -----------------------

    @Test
    void reportRateLimit_thenNextAcquireSkipsTheRateLimitedAccount() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());

        Account a0 = new Account();
        a0.id = "acc0";
        a0.enabled = true;
        store.add("provider", a0);

        Account a1 = new Account();
        a1.id = "acc1";
        a1.enabled = true;
        store.add("provider", a1);

        ManagerOptions opts = new ManagerOptions();
        opts.strategy = Strategy.ROUND_ROBIN;
        FixedClock clock = new FixedClock(1_000_000L);
        AccountManager manager = manager("provider", store, opts, new FakeHttpClient(), clock, () -> 0.5, new SimpleJsonCodec());

        Acquired first = manager.acquire("messages");
        assertNotNull(first);

        manager.reportRateLimit(first.account.id, "messages", clock.now() + 60_000L);

        Acquired second = manager.acquire("messages");
        assertNotNull(second);
        assertNotEquals(first.account.id, second.account.id); // round-robin skips the now rate-limited account
    }

    @Test
    void reportError_setsCoolingDownUntilViaDeterministicBackoff() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());

        Account account = new Account();
        account.id = "acc1";
        account.enabled = true;
        store.add("provider", account);

        FixedClock clock = new FixedClock(1_000_000L);
        Random rng = () -> 0.5;
        AccountManager manager = manager("provider", store, new ManagerOptions(), new FakeHttpClient(), clock, rng, new SimpleJsonCodec());

        manager.reportError("acc1", "chat", 0, "boom");

        // attempt=0, base=1000, max=300000: raw=min(300000,1000)=1000; jittered=floor(500+0.5*500)=750
        Account persisted = store.list("provider").get(0);
        assertEquals(clock.now() + 750L, persisted.coolingDownUntil);
        assertEquals("boom", persisted.cooldownReason);
    }

    @Test
    void reportError_sameLane_yieldsToActiveProviderReset_doesNotSetCoolingDownUntil() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());

        Account account = new Account();
        account.id = "acc1";
        account.enabled = true;
        store.add("provider", account);

        FixedClock clock = new FixedClock(1_000_000L);
        AccountManager manager = manager("provider", store, new ManagerOptions(), new FakeHttpClient(), clock, () -> 0.5, new SimpleJsonCodec());

        manager.reportRateLimit("acc1", "chat", clock.now() + 60_000L); // provider reset still active
        manager.reportError("acc1", "chat", 0, "boom"); // same lane as the active reset

        Account persisted = store.list("provider").get(0);
        assertNull(persisted.coolingDownUntil); // core's generic backoff yielded to the provider reset
        assertNull(persisted.cooldownReason);
        assertEquals(clock.now() + 60_000L, persisted.rateLimitResetTimes.get("chat"));
    }

    @Test
    void reportError_crossLane_doesNotYieldToAnUnrelatedLanesActiveReset() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());

        Account account = new Account();
        account.id = "acc1";
        account.enabled = true;
        store.add("provider", account);

        FixedClock clock = new FixedClock(1_000_000L);
        AccountManager manager = manager("provider", store, new ManagerOptions(), new FakeHttpClient(), clock, () -> 0.5, new SimpleJsonCodec());

        manager.reportRateLimit("acc1", "gemini-pro", clock.now() + 60_000L); // unrelated lane's reset, still active
        manager.reportError("acc1", "gemini-flash", 0, "boom"); // a DIFFERENT lane's generic error

        // the unrelated lane's reset must not suppress this lane's cooldown -- otherwise the
        // account would be immediately re-selectable for gemini-flash with zero backoff
        Account persisted = store.list("provider").get(0);
        assertEquals(clock.now() + 750L, persisted.coolingDownUntil);
        assertEquals("boom", persisted.cooldownReason);
        assertEquals(clock.now() + 60_000L, persisted.rateLimitResetTimes.get("gemini-pro")); // untouched
    }

    @Test
    void reportError_missingLane_treatsItAsNoSameLaneResetKnownAndCoolsDownNormally() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());

        Account account = new Account();
        account.id = "acc1";
        account.enabled = true;
        store.add("provider", account);

        FixedClock clock = new FixedClock(1_000_000L);
        AccountManager manager = manager("provider", store, new ManagerOptions(), new FakeHttpClient(), clock, () -> 0.5, new SimpleJsonCodec());

        manager.reportRateLimit("acc1", "chat", clock.now() + 60_000L); // active reset on SOME lane
        manager.reportError("acc1", null, 0, "boom"); // caller doesn't know the failing request's lane

        Account persisted = store.list("provider").get(0);
        assertEquals(clock.now() + 750L, persisted.coolingDownUntil); // the safe default: cools normally
        assertEquals("boom", persisted.cooldownReason);
    }

    @Test
    void reportError_appliesBackoffWhenNoActiveProviderReset() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());

        Account account = new Account();
        account.id = "acc1";
        account.enabled = true;
        account.rateLimitResetTimes = new java.util.LinkedHashMap<>();
        account.rateLimitResetTimes.put("chat", 500_000L); // expired -- in the past
        store.add("provider", account);

        FixedClock clock = new FixedClock(1_000_000L);
        AccountManager manager = manager("provider", store, new ManagerOptions(), new FakeHttpClient(), clock, () -> 0.5, new SimpleJsonCodec());

        manager.reportError("acc1", "chat", 0, "boom");

        Account persisted = store.list("provider").get(0);
        assertEquals(clock.now() + 750L, persisted.coolingDownUntil); // same math as reportError_setsCoolingDownUntilViaDeterministicBackoff
        assertEquals("boom", persisted.cooldownReason);
    }

    @Test
    void reportSuccess_clearsCooldownAndBumpsLastUsed() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());

        FixedClock clock = new FixedClock(1_000_000L);
        Account account = new Account();
        account.id = "acc1";
        account.enabled = true;
        account.coolingDownUntil = clock.now() + 60_000L;
        account.cooldownReason = "boom";
        store.add("provider", account);

        AccountManager manager = manager("provider", store, new ManagerOptions(), new FakeHttpClient(), clock, () -> 0.5, new SimpleJsonCodec());
        manager.reportSuccess("acc1");

        Account persisted = store.list("provider").get(0);
        assertEquals(0L, persisted.coolingDownUntil);
        assertNull(persisted.cooldownReason);
        assertEquals(clock.now(), persisted.lastUsed);
    }

    // ---- AccountManager.nextAvailableAt / refresh (force) ------------------------------------

    @Test
    void nextAvailableAt_returnsSoonestResetAcrossPool() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());

        FixedClock clock = new FixedClock(1_000_000L);
        long now = clock.now();
        Account a0 = new Account();
        a0.id = "acc0";
        a0.enabled = true;
        a0.coolingDownUntil = now + 10_000L;
        store.add("provider", a0);

        Account a1 = new Account();
        a1.id = "acc1";
        a1.enabled = true;
        a1.coolingDownUntil = now + 2_000L;
        store.add("provider", a1);

        AccountManager manager = manager("provider", store, new ManagerOptions(), new FakeHttpClient(), clock, () -> 0.5, new SimpleJsonCodec());
        Long next = manager.nextAvailableAt(null);

        assertEquals(now + 2_000L, next); // soonest of the two
    }

    @Test
    void nextAvailableAt_returnsNullWhenNoAccountEverBecomesAvailable() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());

        Account disabled = new Account();
        disabled.id = "acc0";
        disabled.enabled = false;
        store.add("provider", disabled);

        AccountManager manager = manager("provider", store, new ManagerOptions(), new FakeHttpClient(),
                new FixedClock(1_000_000L), () -> 0.5, new SimpleJsonCodec());
        Long next = manager.nextAvailableAt(null);

        assertNull(next);
    }

    @Test
    void refresh_forcesRefreshRegardlessOfExpiry() {
        AccountStore store = new AccountStore(new InMemoryStore(), new SimpleJsonCodec());

        Account account = new Account();
        account.id = "acc1";
        account.enabled = true;
        account.refresh = "old-refresh";
        account.access = "still-valid-access";
        account.expires = 999_999_999_999L; // nowhere near expiry
        store.add("provider", account);

        FakeHttpClient fake = new FakeHttpClient();
        fake.responseBody = "{\"access_token\":\"forced-access\",\"expires_in\":3600}";

        ManagerOptions opts = new ManagerOptions();
        opts.oauth = oauthConfig();

        AccountManager manager = manager("provider", store, opts, fake, new FixedClock(1_000_000L), () -> 0.5, new SimpleJsonCodec());
        String access = manager.refresh("acc1");

        assertEquals("forced-access", access);
        assertEquals(1, fake.callCount); // called even though the token wasn't expired
        assertEquals("forced-access", store.list("provider").get(0).access);
    }
}
