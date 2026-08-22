package io.github.intisy.ai.shared.routing;

import java.util.List;

/**
 * A titled group of {@link ConfigField}s, matching one entry of the {@code GET /v1/config}
 * wire shape's {@code groups[]} array.
 */
public final class ConfigGroup {
    public String title;
    public List<ConfigField> fields;

    public ConfigGroup() {
    }

    public ConfigGroup(String title, List<ConfigField> fields) {
        this.title = title;
        this.fields = fields;
    }
}
