package io.github.intisy.ai.shared.routing;

import java.util.List;

/**
 * One account's usage in a {@link QuotaProvider} result, matching one entry of the existing
 * {@code GET /v1/quota} wire shape ({@code accounts[]}): the account-level {@link #accountId},
 * {@link #accountEmail}, and {@link #accountStatus} (e.g. active|rate-limited|error) plus its list
 * of pool {@link #bars}. Keeping the grouping per-account (rather than flattening every bar into one
 * account-keyed list) preserves accounts that have no bars: an errored account whose quota couldn't
 * be fetched still appears, which the dashboard's account count relies on.
 */
public final class AccountQuota {
    /** Identifies the account within its provider's account store. */
    public String accountId;
    /** The account's display email, when the provider surfaces one. */
    public String accountEmail;
    /** The account's current status token (e.g. active|rate-limited|error). */
    public String accountStatus;
    /** This account's usage pools, empty when none could be fetched. */
    public List<QuotaBar> bars;

    /** Empty constructor for JSON deserialization. */
    public AccountQuota() {
    }

    /**
     * @param accountId the account's store key
     * @param accountEmail the account's display email, or {@code null} when it has none
     * @param accountStatus the account's current status token
     * @param bars the account's usage pools
     */
    public AccountQuota(String accountId, String accountEmail, String accountStatus, List<QuotaBar> bars) {
        this.accountId = accountId;
        this.accountEmail = accountEmail;
        this.accountStatus = accountStatus;
        this.bars = bars;
    }
}
