// @ts-nocheck
// The single entry a provider plugin calls: from one ProviderDef it yields the generic app plugin
// hook. The provider's IR-native handleIr is exposed by the provider's own handler module (what
// the proxy front-door loads); core-auth does not re-wrap a legacy app-wire handle() here.

import { createProviderPlugin } from "./provider-plugin-runtime.js";

export function defineProvider(def) {
  return {
    def,
    plugin: createProviderPlugin(def),
  };
}
