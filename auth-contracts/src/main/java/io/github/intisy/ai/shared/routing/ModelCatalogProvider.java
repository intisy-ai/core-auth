package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.ir.spi.HandlerCtx;
import java.util.List;

/**
 * Optional capability: a provider that exposes its native model catalog as a typed method instead
 * of a {@code /v1/models} URL branch inside {@code handle()}.
 */
public interface ModelCatalogProvider {
    List<ModelInfo> models(HandlerCtx ctx);
}
