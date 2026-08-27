package io.github.intisy.ai.shared.routing;

import java.util.List;

/**
 * A titled group of {@link ConfigField}s, matching one entry of the {@code GET /v1/config}
 * wire shape's {@code groups[]} array.
 */
public final class ConfigGroup {
    /** The group's display title. */
    public String title;
    /** The settings this group contains. */
    public List<ConfigField> fields;

    /** Empty constructor for JSON deserialization. */
    public ConfigGroup() {
    }

    /**
     * @param title the group's display title
     * @param fields the settings this group contains
     */
    public ConfigGroup(String title, List<ConfigField> fields) {
        this.title = title;
        this.fields = fields;
    }
}
