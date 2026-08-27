package io.github.intisy.ai.shared.oauth;

/**
 * Java analog of the JS {@code { access, expires, refresh }} object returned by
 * {@code refreshAccessToken} (see {@code libs/core-auth/src/oauth.ts}).
 */
public class Refreshed {
    /** The new access token. */
    public final String access;
    /** Epoch ms the new access token expires at. */
    public final long expires;
    /** The refresh token to store going forward, which may be unchanged from what was sent. */
    public final String refresh;

    /**
     * @param access the new access token
     * @param expires epoch ms the new access token expires at
     * @param refresh the refresh token to store going forward
     */
    public Refreshed(String access, long expires, String refresh) {
        this.access = access;
        this.expires = expires;
        this.refresh = refresh;
    }
}
