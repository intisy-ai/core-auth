package io.github.intisy.ai.auth.contracts;

import io.github.intisy.ai.tsemit.TsInterface;
import io.github.intisy.ai.tsemit.TsOptional;
import java.util.Map;

/**
 * One upstream lane a provider plugin serves, as a host lists it.
 *
 * @implNote A lane is described rather than inferred from the plugin's identity, because a plugin may
 * back several lanes off one driver (a shared account pool with distinct upstream quotas) or resolve
 * them from the user's own configuration.
 */
@TsInterface(data = true)
public interface ProviderDescriptor {
    /**
     * The provider id a routing chain names.
     *
     * @return the provider id
     */
    String id();

    /**
     * The lane's display label, shown wherever a host lists it for a person to pick.
     *
     * @return the display label
     */
    String label();

    /**
     * Models this lane serves, keyed by model id.
     *
     * @return the lane's models, or {@code null} when the lane does not advertise a catalog
     */
    @TsOptional
    Map<String, Object> models();

    /**
     * Whether accounts for this lane are obtained through an OAuth flow.
     *
     * @return whether this lane's accounts come from OAuth, or {@code null} when unknown
     */
    @TsOptional
    Boolean hasOAuth();

    /**
     * Account store key, when several lanes share one pool. Defaults to the lane's own id.
     *
     * @return the shared account pool key, or {@code null} to use this lane's own id
     */
    @TsOptional
    String accountPool();

    /**
     * Wire format this lane speaks upstream, when it is not the plugin's default.
     *
     * @return the upstream wire format, or {@code null} to use the plugin's default
     */
    @TsOptional
    String translator();
}
