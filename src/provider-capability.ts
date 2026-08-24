import type { HandlerCtx } from "@intisy-ai/core-ir";
import type { Provider, ProviderDescriptor } from "./generated/auth-contracts.js";
import type { ProviderDef } from "./types.js";

export type { Provider, ProviderDescriptor } from "./generated/auth-contracts.js";

/** Extra lanes beyond the driver's own, either fixed or resolved when a host asks. */
export type ExtraLanes = ProviderDescriptor[] | (() => ProviderDescriptor[] | Promise<ProviderDescriptor[]>);

async function resolveExtra(extra: ExtraLanes | undefined): Promise<ProviderDescriptor[]> {
  if (!extra) return [];
  if (Array.isArray(extra)) return extra;
  try {
    return await extra();
  } catch {
    return [];
  }
}

/** How this driver's own lane is listed. */
export function descriptorFor(driver: ProviderDef): ProviderDescriptor {
  return {
    id: driver.id,
    label: driver.label,
    models: driver.models as Record<string, unknown>,
    hasOAuth: typeof driver.loginFlow === "function",
    accountPool: driver.id,
  };
}

/**
 * The `provider` capability for a core-auth driver.
 *
 * @remarks
 * A lane resolver that throws costs this plugin its extra lanes and never its own: a provider whose
 * user configuration is unreadable must still serve the lane it ships with, and a throw out of
 * `providers()` would quarantine the whole plugin.
 *
 * @param driver - the provider this capability speaks for
 * @param extra - lanes beyond the driver's own, for a plugin backing several upstream quotas
 */
export function providerCapability(driver: ProviderDef, extra?: ExtraLanes): Provider {
  const handleIr = driver.handleIr;
  if (typeof handleIr !== "function") {
    throw new Error(`provider ${driver.id} has no handleIr: a provider must implement handleIr(request, context)`);
  }
  return {
    id: driver.id,
    handleIr: (request, context: HandlerCtx) => handleIr(request, context),
    providers: async () => [descriptorFor(driver), ...(await resolveExtra(extra))],
  };
}
