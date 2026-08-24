import type { AccountController, ProviderDef } from "./types.js";
import { printAccounts } from "./account-cli.js";
import { providerCapability } from "./provider-capability.js";
import type { ExtraLanes, Provider } from "./provider-capability.js";

/**
 * The service id a host offers this library's provider helpers under.
 *
 * @remarks
 * Bare rather than namespaced by a plugin, because it names a CONTRACT a host fulfils rather than
 * one plugin's offering. A provider states it under `services.consumes` in its manifest and mints
 * the key with `ctx.service(id)`, so it never imports this library for behaviour.
 */
export const PROVIDER_SUPPORT = "provider-support";

/** What a host offers a provider plugin under {@link PROVIDER_SUPPORT}. */
export interface ProviderSupport {
  /**
   * Builds the `provider` capability for a driver.
   *
   * @param driver - the provider this capability speaks for
   * @param extra - lanes beyond the driver's own, for a plugin backing several upstream quotas
   */
  capability(driver: ProviderDef, extra?: ExtraLanes): Provider;
  /** Writes an account list to stdout, for a provider's `accounts` action. */
  printAccounts(providerId: string, accounts: AccountController): void;
}

/**
 * This library's provider helpers, for a host to offer.
 *
 * @remarks
 * One implementation the host links, rather than a copy in every provider: a TeaVM bundle
 * statically links everything its entry reaches, so a helper each provider imported would be a
 * private copy per plugin in one process.
 */
export function providerSupport(): ProviderSupport {
  return { capability: providerCapability, printAccounts };
}
