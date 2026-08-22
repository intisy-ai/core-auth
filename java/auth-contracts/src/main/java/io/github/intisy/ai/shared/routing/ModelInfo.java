package io.github.intisy.ai.shared.routing;

/**
 * A single model entry from a {@link ModelCatalogProvider}, matching one entry of the existing
 * {@code GET /v1/models} wire shape's {@code models{id: {name,context?,output?}}} map (list order
 * from {@link ModelCatalogProvider#models} is the wire shape's {@code ranking} array).
 */
public final class ModelInfo {
    public String id;
    public String name;
    public int context;
    public int output;

    public ModelInfo() {
    }

    public ModelInfo(String id, String name, int context, int output) {
        this.id = id;
        this.name = name;
        this.context = context;
        this.output = output;
    }
}
