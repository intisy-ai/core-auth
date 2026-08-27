package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.ir.spi.HandlerCtx;
import java.util.List;

/**
 * Optional capability: a provider that exposes per-account usage as a typed method instead of a
 * {@code /v1/quota} URL branch inside {@code handle()}. One {@link AccountQuota} per account (each
 * carrying its own pool bars), matching the {@code accounts[]} wire shape.
 */
public interface QuotaProvider {
    /**
     * This provider's per-account usage.
     *
     * @param ctx the request context
     * @return one entry per account
     */
    List<AccountQuota> quota(HandlerCtx ctx);
}
