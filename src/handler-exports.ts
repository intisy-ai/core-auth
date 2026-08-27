// The provider handler.ts export block (handleIr/accounts/loginFlow/menu/menuModel) is
// near-identical across every provider that wraps a single driver, so it is built from the driver
// once here instead of hand-duplicated per provider. What a provider ADVERTISES is its `provider`
// capability's business (see provider-capability.ts), not this module's.

import { runProviderMenu } from "./menu.js";
import { buildAccountMenu } from "./ui/menu-model.js";
import type { ProviderDef } from "./types.js";

export interface ProviderHandlerExports {
  handleIr: ProviderDef["handleIr"];
  accounts?: ProviderDef["accounts"];
  menu?: () => Promise<void>;
  menuModel?: () => ReturnType<typeof buildAccountMenu>;
  loginFlow?: ProviderDef["loginFlow"];
}

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
