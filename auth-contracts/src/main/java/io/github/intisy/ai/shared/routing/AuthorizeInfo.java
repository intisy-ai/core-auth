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
    public String authorizeUrl;
    public String completion; // paste|loopback
    public String state;
    public Integer loopbackPort;
    public String loopbackPath;

    public AuthorizeInfo() {
    }

    public AuthorizeInfo(String authorizeUrl, String completion, String state,
                          Integer loopbackPort, String loopbackPath) {
        this.authorizeUrl = authorizeUrl;
        this.completion = completion;
        this.state = state;
        this.loopbackPort = loopbackPort;
        this.loopbackPath = loopbackPath;
    }
}
