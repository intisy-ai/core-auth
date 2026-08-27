package io.github.intisy.ai.shared.manager;

import io.github.intisy.ai.shared.select.Strategy;
import io.github.intisy.ai.shared.model.Account;
import io.github.intisy.ai.shared.oauth.OAuthConfig;

import java.util.function.BiPredicate;

/**
 * Java analog of the {@code opts} object passed to the JS {@code AccountManager} constructor
 * (see {@code libs/core-auth/src/manager.ts}). The SPIs it needs (HttpClient/Clock/Random/
 * JsonCodec) are NOT fields here - they're injected straight into the {@link AccountManager}
 * constructor, since they're wiring concerns of the host app rather than manager policy.
 */
public class ManagerOptions {
    /** Which account selection strategy {@link AccountManager} uses. */
    public Strategy strategy = Strategy.HYBRID;
    /** OAuth endpoint config; {@code null} disables refresh, so {@code ensureAccess} returns the stored access as-is. */
    public OAuthConfig oauth;

    /** Matches JS ratelimit.ts {@code calculateBackoffMs} defaults: baseMs=1000, maxMs=5*60*1000. */
    public long backoffBaseMs = 1000L;
    /** The backoff ceiling; see {@link #backoffBaseMs}. */
    public long backoffMaxMs = 5 * 60 * 1000L;

    /** Extra availability predicate {@code (account, lane) -> boolean}, AND-ed onto {@link io.github.intisy.ai.shared.select.RateLimitMath#isAvailable}. */
    public BiPredicate<Account, String> extraAvailable;
}
