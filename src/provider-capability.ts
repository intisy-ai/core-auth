import type { ProviderDef } from "./types.js";

/**
 * One upstream lane a provider serves, structurally identical to api's `ProviderDescriptor`.
 *
 * @remarks
 * Mirrored rather than imported: core-auth carries no submodules, so it cannot resolve
 * `@intisy-ai/api` the way a provider repo does through its nested `core/api`. TypeScript matches
 * these by shape, so a value built here satisfies api's interface with no cast, exactly as
 * `provider-plugin.ts` already does for core's shapes.
 */
export interface ProviderDescriptor {
  id: string;
  label: string;
  models?: Record<string, unknown>;
  hasOAuth?: boolean;
  accountPool?: string;
  translator?: string;
}

/** Talks to one upstream vendor in canonical IR, structurally identical to api's capability. */
export interface ProviderCapability {
  readonly id: string;
  /**
   * Handles one request in canonical IR.
   *
   * @remarks
   * `any` rather than a mirrored IR union, because a return type is covariant: `unknown` would make
   * this whole interface un-assignable to api's, which is the one thing the mirror exists to
   * guarantee. The driver's own signature is the real contract.
   */
  handleIr(request: unknown, context: unknown): Promise<any>;
  providers(): Promise<ProviderDescriptor[]>;
}

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
export function providerCapability(driver: ProviderDef, extra?: ExtraLanes): ProviderCapability {
  const handleIr = driver.handleIr;
  if (typeof handleIr !== "function") {
    throw new Error(`provider ${driver.id} has no handleIr: a provider must implement handleIr(request, context)`);
  }
  return {
    id: driver.id,
    handleIr: (request: unknown, context: unknown) => handleIr(request, context),
    providers: async () => [descriptorFor(driver), ...(await resolveExtra(extra))],
  };
}
