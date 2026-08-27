// The provider handler.ts export block (handleIr/accounts/loginFlow/menu/menuModel) is
// near-identical across every provider that wraps a single driver, so it is built from the driver
// once here instead of hand-duplicated per provider. What a provider ADVERTISES is its `provider`
// capability's business (see provider-capability.ts), not this module's.

import { runProviderMenu } from "./menu.js";
import { buildAccountMenu } from "./ui/menu-model.js";
import type { ProviderDef } from "./types.js";

/** The handler.ts export block a provider's handler module re-exports; `menu`/`menuModel` are present only when the driver has accounts. */
export interface ProviderHandlerExports {
  /** The provider's canonical-IR entry point. */
  handleIr: ProviderDef["handleIr"];
  /** The provider's account operations, when it has accounts. */
  accounts?: ProviderDef["accounts"];
  /** Runs the shared account-management menu. */
  menu?: () => Promise<void>;
  /** Builds the shared account-management menu model. */
  menuModel?: () => ReturnType<typeof buildAccountMenu>;
  /** The provider's split begin/complete OAuth flow. */
  loginFlow?: ProviderDef["loginFlow"];
}

/** Builds a provider's handler.ts export block from its driver, so the near-identical shape across every single-driver provider is built once here rather than hand-duplicated per provider. */
export function providerHandlerExports(driver: ProviderDef): ProviderHandlerExports {
  const hasOAuth = typeof driver.loginFlow === "function";
  const exports: ProviderHandlerExports = {
    handleIr: driver.handleIr,
  };
  if (driver.accounts) {
    exports.accounts = driver.accounts;
    exports.menu = () => runProviderMenu(driver);
    exports.menuModel = () => buildAccountMenu(driver);
  }
  if (hasOAuth) exports.loginFlow = driver.loginFlow;
  return exports;
}
