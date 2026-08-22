package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.ir.spi.HandlerCtx;
import java.util.Map;

/**
 * Optional capability: a provider that exposes its own OAuth login flow as typed methods instead
 * of {@code /v1/oauth/authorize} and {@code /v1/oauth/exchange} URL branches inside {@code
 * handle()}.
 */
public interface OAuthProvider {
    AuthorizeInfo authorize(HandlerCtx ctx);

    /** {@code body} is the raw exchange request payload (e.g. {@code {code,state}} JSON); returns {@code {account:...}}. */
    Map<String, Object> exchange(HandlerCtx ctx, String body);
}
