package io.github.intisy.ai.shared.routing;

import java.util.List;

/**
 * A single configurable setting exposed by a {@link ConfigurableProvider}, matching one entry of
 * the existing {@code GET /v1/config} wire shape's {@code groups[].fields[]} (see e.g.
 * claude-code-auth's {@code ClaudeConfig}).
 */
public final class ConfigField {
    public String key;
    public String label;
    public String type; // text|bool|number|select
    public List<String> options;
    // Carries the wire shape's "default" field (the value used when nothing is persisted yet).
    // Named defaultValue because "default" is a reserved word.
    public Object defaultValue;

    public ConfigField() {
    }

    public ConfigField(String key, String label, String type, List<String> options, Object defaultValue) {
        this.key = key;
        this.label = label;
        this.type = type;
        this.options = options;
        this.defaultValue = defaultValue;
    }
}
