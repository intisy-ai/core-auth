package io.github.intisy.ai.shared.routing;

import io.github.intisy.ai.ir.spi.HandlerCtx;
import java.util.Map;

/**
 * Optional capability: a provider that exposes its own settings (config) as typed methods instead
 * of a {@code /v1/config} URL branch inside {@code handle()}. Wire-compatible with the existing
 * {@code GET /v1/config} ({@link #configSchema} + {@link #getConfigValues} together give
 * {@code {groups, values}}) and {@code PUT /v1/config} ({@link #putConfigValues} gives
 * {@code {values}}) shapes.
 */
public interface ConfigurableProvider {
    ConfigSchema configSchema(HandlerCtx ctx);

    Map<String, Object> getConfigValues(HandlerCtx ctx);

    /** Persists {@code values} and returns the re-read, merged values (defaults + overrides). */
    Map<String, Object> putConfigValues(HandlerCtx ctx, Map<String, Object> values);
}
