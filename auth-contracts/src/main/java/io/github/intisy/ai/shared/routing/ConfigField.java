package io.github.intisy.ai.shared.routing;

import java.util.List;

/**
 * A single configurable setting exposed by a {@link ConfigurableProvider}, matching one entry of
 * the existing {@code GET /v1/config} wire shape's {@code groups[].fields[]} (see e.g.
 * claude-code-auth's {@code ClaudeConfig}).
 */
public final class ConfigField {
    /** The setting's key, matched against the values map a {@link ConfigurableProvider} reads/writes. */
    public String key;
    /** The setting's display label. */
    public String label;
    /** The input kind a host renders: {@code text}, {@code bool}, {@code number}, or {@code select}. */
    public String type;
    /** The choices for a {@code select} field; unused otherwise. */
    public List<String> options;
    /**
     * The value used when nothing is persisted yet.
     *
     * @implNote Named {@code defaultValue} rather than the wire shape's own {@code default}
     * because {@code default} is a reserved word in Java.
     */
    public Object defaultValue;

    /** Empty constructor for JSON deserialization. */
    public ConfigField() {
    }

    /**
     * @param key the setting's key
     * @param label the setting's display label
     * @param type the input kind: {@code text}, {@code bool}, {@code number}, or {@code select}
     * @param options the choices for a {@code select} field, or {@code null} otherwise
     * @param defaultValue the value used when nothing is persisted yet
     */
    public ConfigField(String key, String label, String type, List<String> options, Object defaultValue) {
        this.key = key;
        this.label = label;
        this.type = type;
        this.options = options;
        this.defaultValue = defaultValue;
    }
}
