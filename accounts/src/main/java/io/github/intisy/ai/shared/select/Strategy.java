package io.github.intisy.ai.shared.select;

/**
 * Account selection strategy, ported from the string literals in
 * {@code libs/core-auth/src/selection.ts} ("round-robin" / "sticky" / "hybrid").
 */
public enum Strategy {
    /** Advances the cursor on every call, cycling through every available account in turn. */
    ROUND_ROBIN,
    /** Keeps the cursor on the same account until it becomes unavailable. */
    STICKY,
    /** Sticky, but falls back to whoever frees up soonest when nobody is currently available. */
    HYBRID
}
