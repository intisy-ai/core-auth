package io.github.intisy.ai.shared.routing;

import java.util.List;

/**
 * The full settings schema a {@link ConfigurableProvider} exposes, matching the {@code groups}
 * half of the {@code GET /v1/config} wire shape (the other half, {@code values}, is returned
 * separately by {@link ConfigurableProvider#getConfigValues}).
 */
public final class ConfigSchema {
    public List<ConfigGroup> groups;

    public ConfigSchema() {
    }

    public ConfigSchema(List<ConfigGroup> groups) {
        this.groups = groups;
    }
}
