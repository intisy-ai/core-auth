package io.github.intisy.ai.auth.contracts;

import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.ir.spi.HandlerCtx;
import io.github.intisy.ai.ir.spi.IrHandler;
import io.github.intisy.ai.tsemit.TsInterface;
import io.github.intisy.ai.tsemit.TsMaybeAsync;
import io.github.intisy.ai.tsemit.TsOptional;
import io.github.intisy.ai.tsemit.TsProperty;
import io.github.intisy.ai.tsemit.TsUnion;
import java.util.List;

/**
 * Talks to one upstream vendor, in canonical IR only.
 *
 * @implNote A provider never sees an app's wire format: it translates IR into its own upstream vendor
 * format, calls upstream, and decodes the reply back into IR. On a non-2xx upstream outcome it THROWS
 * the typed handler error rather than returning it as data, so the front-door can rebuild the
 * response and rate-limit fallback keeps working. {@code id} and {@code handleIr} are redeclared
 * rather than inherited because the emitter walks only a type's own members, so an inherited one
 * would be absent from the emitted declaration.
 */
@TsInterface
public interface Provider extends IrHandler {
    /** The provider id a routing chain names. */
    @Override
    @TsProperty(readOnly = true)
    String id();

    /** Serves one canonical IR request against this provider's upstream; a non-2xx outcome is thrown, never returned as data. */
    @Override
    @TsUnion(value = {"IrResponse", "IrEventStream"}, async = true)
    IrResponse handleIr(IrRequest request, HandlerCtx ctx) throws Exception;

    /**
     * Every lane this plugin serves, when it serves more than the one {@code id} names, or
     * {@code null} when it serves only that one.
     *
     * @return the lanes this plugin serves, or {@code null} for a single-lane provider
     * @implNote Defaulted rather than abstract so the optionality the emitted declaration carries
     * also holds in Java: a one-lane provider does not write this method at all, and a host reads
     * {@code null} as the lane list being absent rather than as serving no lanes.
     */
    @TsOptional
    @TsMaybeAsync
    default List<ProviderDescriptor> providers() {
        return null;
    }
}
