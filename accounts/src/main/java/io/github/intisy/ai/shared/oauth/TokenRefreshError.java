package io.github.intisy.ai.shared.oauth;

/**
 * Java analog of the JS {@code TokenRefreshError} (see {@code libs/core-auth/src/oauth.ts:22-32}).
 * {@code revoked} is {@code true} exactly when the token endpoint reported
 * {@code error=invalid_grant} — the refresh token itself was revoked/expired, so the account
 * needs re-auth rather than a retry.
 *
 * @implNote {@code status}/{@code code}/{@code description} are carried as fields rather than only
 * being folded into the message, because the JS error this is the analog of exposes them and a
 * caller reached through the TeaVM boundary can only read what the value carries.
 */
public class TokenRefreshError extends RuntimeException {
    public final boolean revoked;

    /** The token endpoint's HTTP status, or {@code null} when the request never got a response. */
    public final Integer status;

    /** The endpoint's {@code error} code (e.g. {@code invalid_grant}), when it reported one. */
    public final String code;

    /** The endpoint's {@code error_description}, or the raw body when it was not a JSON error. */
    public final String description;

    public TokenRefreshError(String message, boolean revoked) {
        this(message, revoked, null, null, null);
    }

    public TokenRefreshError(String message, boolean revoked, Integer status, String code, String description) {
        super(message);
        this.revoked = revoked;
        this.status = status;
        this.code = code;
        this.description = description;
    }

    public TokenRefreshError(String message, Throwable cause) {
        super(message, cause);
        this.revoked = false;
        this.status = null;
        this.code = null;
        this.description = null;
    }
}
