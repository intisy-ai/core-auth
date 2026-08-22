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
    public String accountId;
    public String accountEmail;
    public String accountStatus;
    public List<QuotaBar> bars;

    public AccountQuota() {
    }

    public AccountQuota(String accountId, String accountEmail, String accountStatus, List<QuotaBar> bars) {
        this.accountId = accountId;
        this.accountEmail = accountEmail;
        this.accountStatus = accountStatus;
        this.bars = bars;
    }
}
