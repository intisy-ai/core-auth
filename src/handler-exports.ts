// @ts-nocheck
// The provider handler.ts export block (handleIr/accounts/loginFlow/menu/menuModel/def)
// is near-identical across every provider that wraps a single driver. This builds that
// common set from the driver so each provider's handler.ts spreads it instead of
// hand-duplicating five lines of glue. A provider that also serves multiple first-class
// providers off one driver (defs) or resolves them dynamically (resolveProviders) keeps
// exporting those itself, alongside the spread:
//
//   export const { handleIr, accounts, loginFlow, menu, menuModel, def } = providerHandlerExports(driver);
//   export const defs = [def, { ...secondDef }];               // antigravity-style
//   export { resolveProviders } from "./driver.js";              // custom-auth-style

import { runProviderMenu } from "./menu.js";
import { buildAccountMenu } from "./ui/menu-model.js";

export function providerHandlerExports(driver) {
  const hasOAuth = typeof driver.loginFlow === "function";
  const exports = {
    handleIr: driver.handleIr,
    def: {
      id: driver.id,
      label: driver.label,
      models: driver.models,
      hasOAuth,
      settings: driver.settings,
      accountPool: driver.id,
    },
  };
  if (driver.accounts) {
    exports.accounts = driver.accounts;
    exports.menu = () => runProviderMenu(driver);
    exports.menuModel = () => buildAccountMenu(driver);
  }
  if (hasOAuth) exports.loginFlow = driver.loginFlow;
  return exports;
}
