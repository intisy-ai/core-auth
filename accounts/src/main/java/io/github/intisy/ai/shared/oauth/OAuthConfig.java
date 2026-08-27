package io.github.intisy.ai.shared.oauth;

import java.util.Map;

/**
 * Java analog of the JS {@code opts} object accepted by {@code refreshAccessToken}
 * (see {@code libs/core-auth/src/oauth.ts}) - the driver-supplied OAuth endpoint config.
 */
public class OAuthConfig {
    /** The token endpoint a refresh or code exchange POSTs to. */
    public String tokenUrl;
    /** The OAuth client id sent with every grant. */
    public String clientId;
    /** The OAuth client secret, omitted from the form when {@code null}. */
    public String clientSecret;
    /** Provider-specific extra form fields to send with every grant, or {@code null} for none. */
    public Map<String, String> extraParams;

    /** The provider's authorization endpoint, or {@code null} when this config is refresh-only. */
    public String authorizeUrl;
    /** The default redirect URI for this client, or {@code null} for none. */
    public String redirectUri;
    /** Space-delimited scope string to request, or {@code null} for the provider's default. */
    public String scopes;
    /** Whether the authorization-code flow uses PKCE (S256). */
    public boolean usePkce;
}
