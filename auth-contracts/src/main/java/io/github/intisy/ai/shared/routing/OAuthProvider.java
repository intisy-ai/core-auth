package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.ir.spi.HandlerCtx;
import java.util.Map;

/**
 * Optional capability: a provider that exposes its own OAuth login flow as typed methods instead
 * of {@code /v1/oauth/authorize} and {@code /v1/oauth/exchange} URL branches inside {@code
 * handle()}.
 */
public interface OAuthProvider {
    /**
     * Starts a login and returns what the operator needs to complete it.
     *
     * @param ctx the request context
     * @return the parameters to start the OAuth login
     */
    AuthorizeInfo authorize(HandlerCtx ctx);

    /**
     * Completes a login started by {@link #authorize}.
     *
     * @param ctx the request context
     * @param body the raw exchange request payload (e.g. {@code {code,state}} JSON)
     * @return the resulting account, as {@code {account:...}}
     */
    Map<String, Object> exchange(HandlerCtx ctx, String body);
}
