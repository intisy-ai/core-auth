package io.github.intisy.ai.shared.manager;

import io.github.intisy.ai.shared.select.RateLimitMath;
import io.github.intisy.ai.shared.select.Selection;
import io.github.intisy.ai.shared.model.Account;
import io.github.intisy.ai.shared.oauth.Refreshed;
import io.github.intisy.ai.shared.oauth.TokenRefresh;
import io.github.intisy.ai.shared.oauth.TokenRefreshError;
import io.github.intisy.ai.api.seam.Clock;
import io.github.intisy.ai.api.seam.HttpClient;
import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.api.seam.Random;
import io.github.intisy.ai.shared.store.AccountStore;

import java.util.LinkedHashMap;
import java.util.Objects;
import java.util.function.Consumer;

/**
 * The generic multi-account engine (storage, selection, rate-limit/cooldown, OAuth refresh),
 * built on the shared SPIs: {@link AccountStore} (itself on the {@code Store}/{@code JsonCodec}
 * SPIs), {@link Clock} for {@code now}, {@link Random} for backoff jitter, and {@link HttpClient}+
 * {@link JsonCodec} for the OAuth refresh call. No locks/threads here: the atomic
 * read-modify-write is {@code Store.update}'s concern (the implementation's), and the network
 * refresh call in {@link #acquire} is sequenced OUTSIDE any store call, so an account is claimed
 * under the store's lock and refreshed outside it, with no actual locking in this class.
 *
 * <p>Proxy-aware OAuth routing (sending the refresh call through the account's sticky proxy)
 * does not exist in this module yet; {@link ManagerOptions#oauth} is passed to
 * {@link TokenRefresh#refresh} unmodified.
 */
public class AccountManager {
    private final String providerId;
    private final AccountStore store;
    private final HttpClient http;
    private final Clock clock;
    private final Random random;
    private final JsonCodec json;
    private final ManagerOptions opts;

    /**
     * @param providerId the provider id this manager's pool is keyed by
     * @param store the account store backing this manager's pool
     * @param http the HTTP client used for OAuth refresh calls
     * @param clock the clock used for {@code now}, so callers stay deterministic in tests
     * @param random the source of jitter randomness for backoff
     * @param json the codec used by the OAuth refresh call
     * @param opts tuning knobs and hooks; defaulted when {@code null}
     */
    public AccountManager(String providerId, AccountStore store, HttpClient http, Clock clock, Random random,
                           JsonCodec json, ManagerOptions opts) {
        this.providerId = providerId;
        this.store = store;
        this.http = http;
        this.clock = clock;
        this.random = random;
        this.json = json;
        this.opts = opts != null ? opts : new ManagerOptions();
    }

    // matches JS `this.available = (account, lane, now) => builtinAvailable(...) && (!this.extraAvailable || this.extraAvailable(...))`
    private boolean isAvailable(Account account, String lane, long now) {
        if (!RateLimitMath.isAvailable(account, lane, now)) return false;
        return opts.extraAvailable == null || opts.extraAvailable.test(account, lane);
    }

    /**
     * Selection + the {@code lastUsed} claim ONLY -- NO network token refresh. This is the
     * persisted half of {@link #acquire}, split out so a caller that wants to interleave the
     * refresh call with its own proxy/fetch plumbing -- rather than {@link #ensureAccess}'s
     * built-in {@code HttpClient} -- can claim here and run
     * {@link io.github.intisy.ai.shared.oauth.TokenRefresh#refresh} itself afterward. Runs inside
     * {@code store.update} (atomic per the {@code Store} SPI's contract).
     *
     * @param lane the rate-limit lane to select within
     * @return the claimed account with its CURRENT stored {@code access} token as-is (no expiry
     * check, no refresh), or {@code null} when nobody in the pool is available
     */
    public Acquired selectAndClaim(String lane) {
        long now = clock.now();
        String[] claimedId = new String[1];
        store.update(providerId, pool -> {
            int index = Selection.selectIndex(pool, lane, now, opts.strategy, (a, l) -> isAvailable(a, l, now));
            if (index < 0) return;
            Account account = pool.accounts.get(index);
            account.lastUsed = now;
            claimedId[0] = account.id;
        });
        if (claimedId[0] == null) return null;
        Account account = findAccount(claimedId[0]);
        return new Acquired(account, account != null ? account.access : null);
    }

    /**
     * {@link #selectAndClaim}, then a network token refresh ({@link #ensureAccess}) OUTSIDE the
     * store-update call so a slow refresh never blocks other writers (JS manager.ts: {@code
     * acquire}).
     *
     * @param lane the rate-limit lane to select within
     * @return the claimed account with a freshly ensured access token, or {@code null} when
     * nobody in the pool is available
     */
    public Acquired acquire(String lane) {
        Acquired claimed = selectAndClaim(lane);
        if (claimed == null) return null;

        String id = claimed.account.id;
        String access = ensureAccess(id);
        Account account = findAccount(id);
        return new Acquired(account, access);
    }

    /**
     * Refreshes the access token if expired (and a refresh token + oauth config are present),
     * persisting the new access/expires/refresh. A revoked refresh token disables the account
     * so selection skips it going forward (JS manager.ts: {@code ensureAccess}).
     *
     * @param id the account id to ensure a fresh access token for
     * @return the account's access token, refreshed if it was expired, or {@code null} if the
     * account is not found
     */
    public String ensureAccess(String id) {
        Account account = findAccount(id);
        if (account == null) return null;
        long now = clock.now();
        if (!TokenRefresh.accessTokenExpired(account, now)) return account.access;
        if (opts.oauth == null || account.refresh == null) return account.access;
        try {
            Refreshed refreshed = TokenRefresh.refresh(account.refresh, opts.oauth, http, json, now);
            persistRefresh(id, refreshed);
            return refreshed.access;
        } catch (TokenRefreshError e) {
            if (e.revoked) {
                mutate(id, a -> {
                    a.enabled = false;
                    a.disabledReason = "refresh token revoked";
                });
            }
            throw e;
        }
    }

    /**
     * Records an upstream-supplied reset time for one lane on one account.
     *
     * @param id the account id to update
     * @param lane the lane the reset time applies to
     * @param resetMs the epoch ms the lane becomes available again
     */
    public void reportRateLimit(String id, String lane, long resetMs) {
        mutate(id, account -> {
            if (account.rateLimitResetTimes == null) account.rateLimitResetTimes = new LinkedHashMap<>();
            account.rateLimitResetTimes.put(lane, resetMs);
        });
    }

    /**
     * {@code lane} is the failing request's lane, or {@code null}/{@code ""} when the caller
     * doesn't know it (the safe default: no same-lane reset can be found, so this cools down via
     * core's own backoff exactly as if no reset existed).
     *
     * @param id the account id to cool down
     * @param lane the failing request's lane, or {@code null}/empty when unknown
     * @param attempt the zero-based retry attempt number, for backoff growth
     * @param reason the cooldown reason to record, defaulted when {@code null}
     */
    public void reportError(String id, String lane, int attempt, String reason) {
        long now = clock.now();
        mutate(id, account -> {
            // The provider owns its upstream's real retry-after for THIS lane; when it has
            // already supplied an active reset for this exact lane, core's own generic backoff
            // yields to it instead of layering a second, independently-computed timer on top. A
            // reset on some OTHER lane never suppresses this lane's backoff.
            if (RateLimitMath.isLaneRateLimited(account, lane, now)) return;
            long ms = RateLimitMath.calculateBackoffMs(attempt, opts.backoffBaseMs, opts.backoffMaxMs, true, random);
            account.coolingDownUntil = now + ms;
            account.cooldownReason = reason != null ? reason : "transient error";
        });
    }

    /**
     * Clears any cooldown and marks the account as just used.
     *
     * @param id the account id to clear
     */
    public void reportSuccess(String id) {
        long now = clock.now();
        mutate(id, account -> {
            account.coolingDownUntil = 0L;
            account.cooldownReason = null;
            account.lastUsed = now;
        });
    }

    /**
     * Applies {@code fn} to the pool's account with this {@code id}, atomically per
     * {@code store.update}. A no-op when no account matches.
     *
     * @param id the account id to mutate
     * @param fn applied to the matching account
     */
    public void mutate(String id, Consumer<Account> fn) {
        store.update(providerId, pool -> {
            for (Account a : pool.accounts) {
                if (Objects.equals(a.id, id)) {
                    fn.accept(a);
                    return;
                }
            }
        });
    }

    /**
     * Soonest epoch-ms any account in the pool becomes available for {@code lane}, or
     * {@code null} if none ever will (matches JS {@code manager.ts}: {@code best === Infinity
     * ? null : best}).
     *
     * @param lane the rate-limit lane to check
     * @return the soonest epoch ms any account becomes available, or {@code null} if none ever will
     */
    public Long nextAvailableAt(String lane) {
        long now = clock.now();
        long best = Long.MAX_VALUE;
        for (Account account : store.list(providerId)) {
            best = Math.min(best, RateLimitMath.availableAt(account, lane, now));
        }
        return best == Long.MAX_VALUE ? null : best;
    }

    /**
     * Forces a token refresh regardless of expiry (manual "refresh token" action).
     *
     * @param id the account id to refresh
     * @return the new access token, or {@code null} if there's nothing to refresh
     */
    public String refresh(String id) {
        Account account = findAccount(id);
        if (account == null || opts.oauth == null || account.refresh == null) return null;
        long now = clock.now();
        Refreshed refreshed = TokenRefresh.refresh(account.refresh, opts.oauth, http, json, now);
        persistRefresh(id, refreshed);
        return refreshed.access;
    }

    private void persistRefresh(String id, Refreshed refreshed) {
        mutate(id, a -> {
            a.access = refreshed.access;
            a.expires = refreshed.expires;
            if (refreshed.refresh != null) a.refresh = refreshed.refresh;
        });
    }

    private Account findAccount(String id) {
        for (Account a : store.list(providerId)) {
            if (Objects.equals(a.id, id)) return a;
        }
        return null;
    }
}
