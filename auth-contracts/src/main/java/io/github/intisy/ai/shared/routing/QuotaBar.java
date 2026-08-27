package io.github.intisy.ai.shared.routing;

/**
 * A single usage pool bar within an {@link AccountQuota}, matching one entry of the existing
 * {@code GET /v1/quota} wire shape ({@code accounts[].quota[]}). Account-level fields
 * ({@code id}/{@code email}/{@code status}) live on the owning {@link AccountQuota}, not here, so an
 * account with no pool bars (e.g. an errored account whose quota couldn't be fetched) is still
 * represented, rather than vanishing as it would if bars were flattened into one account-keyed list.
 */
public final class QuotaBar {
    /** The pool's display label. */
    public String label;
    /** How much of this pool remains, as a fraction between 0 and 1. */
    public double remainingFraction;
    /** When this pool resets, as the upstream reports it; opaque, never parsed. */
    public String resetTime;

    /** Empty constructor for JSON deserialization. */
    public QuotaBar() {
    }

    /**
     * @param label the pool's display label
     * @param remainingFraction how much of this pool remains, as a fraction between 0 and 1
     * @param resetTime when this pool resets, as the upstream reports it
     */
    public QuotaBar(String label, double remainingFraction, String resetTime) {
        this.label = label;
        this.remainingFraction = remainingFraction;
        this.resetTime = resetTime;
    }
}
