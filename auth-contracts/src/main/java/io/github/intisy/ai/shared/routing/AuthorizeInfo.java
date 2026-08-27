package io.github.intisy.ai.shared.routing;

/**
 * The parameters a provider's {@code authorize} step returns to start an OAuth login, matching
 * the existing {@code GET /v1/oauth/authorize} wire shape. {@link #loopbackPort}/{@link
 * #loopbackPath} are carried for a {@code completion == "loopback"} flow (a provider that runs a
 * local redirect listener rather than asking the operator to paste a code), documented as part of
 * this wire shape by the dashboard consumer ({@code OAuthAdmin}) though no current provider populates
 * them yet.
 */
public final class AuthorizeInfo {
    /** The URL the operator opens in a browser to start the login. */
    public String authorizeUrl;
    /** How the flow completes: {@code paste} (operator pastes a code back) or {@code loopback}. */
    public String completion;
    /** Opaque value the exchange step must echo back, to correlate the callback with this attempt. */
    public String state;
    /** Local port the loopback listener binds, for a {@code completion == "loopback"} flow. */
    public Integer loopbackPort;
    /** Local path the loopback listener answers on, for a {@code completion == "loopback"} flow. */
    public String loopbackPath;

    /** Empty constructor for JSON deserialization. */
    public AuthorizeInfo() {
    }

    /**
     * @param authorizeUrl the URL the operator opens to start the login
     * @param completion how the flow completes, {@code paste} or {@code loopback}
     * @param state opaque value the exchange step must echo back
     * @param loopbackPort local port the loopback listener binds, or {@code null} for a paste flow
     * @param loopbackPath local path the loopback listener answers on, or {@code null} for a paste flow
     */
    public AuthorizeInfo(String authorizeUrl, String completion, String state,
                          Integer loopbackPort, String loopbackPath) {
        this.authorizeUrl = authorizeUrl;
        this.completion = completion;
        this.state = state;
        this.loopbackPort = loopbackPort;
        this.loopbackPath = loopbackPath;
    }
}
