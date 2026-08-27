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
    /**
     * The settings this provider exposes, as groups of fields for a host to render.
     *
     * @param ctx the request context
     * @return the settings schema
     */
    ConfigSchema configSchema(HandlerCtx ctx);

    /**
     * The provider's current settings values, keyed by {@link ConfigField#key}.
     *
     * @param ctx the request context
     * @return the current values
     */
    Map<String, Object> getConfigValues(HandlerCtx ctx);

    /**
     * Persists {@code values} and returns the re-read, merged values (defaults + overrides).
     *
     * @param ctx the request context
     * @param values the values to persist, keyed by {@link ConfigField#key}
     * @return the merged values after persisting
     */
    Map<String, Object> putConfigValues(HandlerCtx ctx, Map<String, Object> values);
}
