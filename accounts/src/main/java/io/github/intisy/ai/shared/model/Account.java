package io.github.intisy.ai.shared.model;

import java.util.Map;

/**
 * Java analog of the JS {@code CoreAccount} (see {@code libs/core-auth/src/types.ts}).
 *
 * Field names and declaration order match the JS source EXACTLY for JSON byte-compatibility:
 * the on-disk {@code accounts.json} must be readable/writable by both this class (via the
 * host app's JsonCodec) and the JS library. Boxed reference types (not primitives) are used
 * throughout so an unset field serializes as "absent" (omitted, same as JS
 * {@code JSON.stringify} omitting {@code undefined} properties) rather than as a noisy default.
 */
public class Account {
    /** Stable identity for this account, usually the account email. */
    public String id;
    /** The account's email, when the provider surfaces one distinct from {@link #id}. */
    public String email;
    /** OAuth refresh token, the durable credential a revoked-token error disables the account for. */
    public String refresh;
    /** OAuth access token, refreshed on demand by {@link #expires}. */
    public String access;
    /** Epoch ms the access token expires at. */
    public Long expires;
    /** Epoch ms the account was first added, for display and ordering. */
    public Long addedAt;
    /** Epoch ms this account was last claimed by selection. */
    public Long lastUsed;
    /**
     * Whether the account is disabled, by the user or by the system (e.g. a revoked refresh
     * token); a disabled account is skipped by selection. {@code null} means enabled.
     */
    public Boolean enabled;
    /** Per-lane epoch ms until which that lane is rate-limited on this account. */
    public Map<String, Long> rateLimitResetTimes;
    /** Epoch ms until which the account is in a transient backoff cooldown across all lanes. */
    public Long coolingDownUntil;
    /** Raw error text behind the current cooldown; transient, never shown in a UI row. */
    public String cooldownReason;
    /** Why the SYSTEM disabled the account, when {@link #enabled} was set to false by the system rather than by the user. */
    public String disabledReason;
    /** Provider-specific extras, opaque to this harness. */
    public Map<String, Object> meta;
}
