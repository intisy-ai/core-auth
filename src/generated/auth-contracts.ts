// Generated from Java sources. Do not edit.

import type { HandlerCtx, IrEventStream, IrRequest, IrResponse } from "../../core-ir/dist/index.js";

/**
 * One upstream lane a provider plugin serves, as a host lists it.
 *
 * @remarks
 * A lane is described rather than inferred from the plugin's identity, because a plugin may
 * back several lanes off one driver (a shared account pool with distinct upstream quotas) or resolve
 * them from the user's own configuration.
 */
export interface ProviderDescriptor {
  /** Account store key, when several lanes share one pool. Defaults to the lane's own id. */
  accountPool?: string;
  /** Whether accounts for this lane are obtained through an OAuth flow. */
  hasOAuth?: boolean;
  /** The provider id a routing chain names. */
  id: string;
  label: string;
  /** Models this lane serves, keyed by model id. */
  models?: Record<string, unknown>;
  /** Wire format this lane speaks upstream, when it is not the plugin's default. */
  translator?: string;
}

/**
 * Talks to one upstream vendor, in canonical IR only.
 *
 * @remarks
 * A provider never sees an app's wire format: it translates IR into its own upstream vendor
 * format, calls upstream, and decodes the reply back into IR. On a non-2xx upstream outcome it THROWS
 * the typed handler error rather than returning it as data, so the front-door can rebuild the
 * response and rate-limit fallback keeps working. `id` and `handleIr` are redeclared
 * rather than inherited because the emitter walks only a type's own members, so an inherited one
 * would be absent from the emitted declaration.
 */
export interface Provider {
  handleIr(request: IrRequest, ctx: HandlerCtx): Promise<IrResponse | IrEventStream>;
  /** The provider id a routing chain names. */
  readonly id: string;
  /**
   * Every lane this plugin serves, when it serves more than the one `id` names, or
   * `null` when it serves only that one.
   *
   * @remarks
   * Defaulted rather than abstract so the optionality the emitted declaration carries
   * also holds in Java: a one-lane provider does not write this method at all, and a host reads
   * `null` as the lane list being absent rather than as serving no lanes.
   */
  providers?(): ProviderDescriptor[] | Promise<ProviderDescriptor[]>;
}

