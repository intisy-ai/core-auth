package io.github.intisy.ai.shared.routing;

/**
 * A single usage pool bar within an {@link AccountQuota}, matching one entry of the existing
 * {@code GET /v1/quota} wire shape ({@code accounts[].quota[]}). Account-level fields
 * ({@code id}/{@code email}/{@code status}) live on the owning {@link AccountQuota}, not here, so an
 * account with no pool bars (e.g. an errored account whose quota couldn't be fetched) is still
 * represented, rather than vanishing as it would if bars were flattened into one account-keyed list.
 */
public final class QuotaBar {
    public String label;
    public double remainingFraction;
    public String resetTime;

    public QuotaBar() {
    }

    public QuotaBar(String label, double remainingFraction, String resetTime) {
        this.label = label;
        this.remainingFraction = remainingFraction;
        this.resetTime = resetTime;
    }
}
