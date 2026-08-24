// @ts-nocheck
// The provider handler.ts export block (handleIr/accounts/loginFlow/menu/menuModel) is
// near-identical across every provider that wraps a single driver, so it is built from the driver
// once here instead of hand-duplicated per provider. What a provider ADVERTISES is its `provider`
// capability's business (see provider-capability.ts), not this module's.

import { runProviderMenu } from "./menu.js";
import { buildAccountMenu } from "./ui/menu-model.js";

export function providerHandlerExports(driver) {
  const hasOAuth = typeof driver.loginFlow === "function";
  const exports = {
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
