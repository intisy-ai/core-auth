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
    /** The provider id a routing chain names. */
    String id();

    String label();

    /** Models this lane serves, keyed by model id. */
    @TsOptional
    Map<String, Object> models();

    /** Whether accounts for this lane are obtained through an OAuth flow. */
    @TsOptional
    Boolean hasOAuth();

    /** Account store key, when several lanes share one pool. Defaults to the lane's own id. */
    @TsOptional
    String accountPool();

    /** Wire format this lane speaks upstream, when it is not the plugin's default. */
    @TsOptional
    String translator();
}
