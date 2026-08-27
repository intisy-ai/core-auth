package io.github.intisy.ai.shared.store;

import io.github.intisy.ai.api.seam.JsonCodec;
import io.github.intisy.ai.api.seam.Store;

import java.util.LinkedHashMap;
import java.util.Map;
import io.github.intisy.ai.seam.JsonUtil;

/**
 * core-auth config: the active provider. Java analog of {@code libs/core-auth/src/config.ts},
 * rewired onto the {@link Store} + {@link JsonCodec} SPIs. Stored under the key
 * {@code "auth.json"}; key-to-location mapping belongs to the {@code Store} implementation, so
 * this class carries no fallback path of its own.
 */
public class AuthConfig {
    private static final String KEY = "auth.json";

    private final Store store;
    private final JsonCodec json;

    /**
     * @param store the key-value backing store to read and write {@code auth.json} through
     * @param json the codec used to parse and serialize the config document
     */
    public AuthConfig(Store store, JsonCodec json) {
        this.store = store;
        this.json = json;
    }

    private Map<String, Object> readConfig() {
        String raw = store.get(KEY);
        if (raw != null) {
            try {
                Map<String, Object> cfg = JsonUtil.asMap(json.parse(raw));
                if (cfg != null) return cfg;
            } catch (Exception ignored) {
                // swallow-all, mirrors the JS readConfig's try/catch degrading to {}
            }
        }
        return new LinkedHashMap<>();
    }

    private void writeConfig(Map<String, Object> cfg) {
        store.put(KEY, json.stringify(cfg));
    }

    /**
     * The active provider id, or {@code ""} if unset (JS parity: {@code readConfig().provider || ""}).
     *
     * @return the active provider id, or the empty string if none is set
     */
    public String activeProvider() {
        Object provider = readConfig().get("provider");
        return provider != null ? provider.toString() : "";
    }

    /**
     * Sets the active provider and writes it to {@code auth.json}.
     *
     * @param id the provider id to make active
     */
    public void setActiveProvider(String id) {
        Map<String, Object> cfg = readConfig();
        cfg.put("provider", id);
        writeConfig(cfg);
    }
}
