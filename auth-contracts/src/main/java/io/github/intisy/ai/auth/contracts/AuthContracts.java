package io.github.intisy.ai.auth.contracts;

import io.github.intisy.ai.tsemit.TsConstant;

/**
 * The typed key this package mints.
 *
 * @implNote The Java field type is {@code Object} and its value {@code null} because the Java side
 * never reads a key: a Java host keys on the id string, and the typed key exists for the emitted
 * TypeScript.
 */
public final class AuthContracts {

    /** The capability key a host looks up a {@link Provider} implementation by. */
    @TsConstant(type = "CapabilityType<Provider>", id = "provider")
    public static final Object PROVIDER = null;

    private AuthContracts() {
    }
}
