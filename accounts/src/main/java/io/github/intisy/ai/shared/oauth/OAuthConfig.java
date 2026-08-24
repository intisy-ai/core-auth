package io.github.intisy.ai.shared.oauth;

import java.util.Map;

/**
 * Java analog of the JS {@code opts} object accepted by {@code refreshAccessToken}
 * (see {@code libs/core-auth/src/oauth.ts:52-62}) — the driver-supplied OAuth endpoint config.
 */
public class OAuthConfig {
    public String tokenUrl;
    public String clientId;
    public String clientSecret;              // optional; omitted from the form when null
    public Map<String, String> extraParams;  // optional provider-specific extra form fields

    public String authorizeUrl;              // optional; the provider's authorization endpoint
    public String redirectUri;               // optional; default redirect for this client
    public String scopes;                    // optional; space-delimited scope string
    public boolean usePkce;                  // whether the flow uses PKCE (S256)
}
