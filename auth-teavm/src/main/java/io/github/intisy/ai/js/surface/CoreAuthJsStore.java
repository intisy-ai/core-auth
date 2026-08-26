package io.github.intisy.ai.js.surface;

import io.github.intisy.ai.tsemit.TsInterface;
import io.github.intisy.ai.tsemit.TsNullable;

/**
 * A host-provided key-value store the account engines read and write, as a TypeScript consumer sees
 * it.
 *
 * @implNote Never implemented, only emitted: the Java bridge it describes speaks JSO types that mean
 * nothing to a TypeScript caller. Every member is synchronous, because the engines call them from
 * transpiled Java that has no way to await.
 */
@TsInterface
public interface CoreAuthJsStore {

    /** The stored value, or null when the key is absent or unreadable. */
    @TsNullable(asNull = true)
    String get(String key);

    /** Stores a value. */
    void put(String key, String value);

    /** Whether the key is present. */
    boolean exists(String key);

    /** Removes the key. */
    void delete(String key);

    /** Every key under the prefix. */
    String[] listKeys(String prefix);
}
