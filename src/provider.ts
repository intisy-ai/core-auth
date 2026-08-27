// The single entry a provider plugin calls: from one ProviderDef it yields the generic app plugin
// hook. The provider's IR-native handleIr is exposed by the provider's own handler module (what
// the proxy front-door loads); core-auth does not re-wrap a legacy app-wire handle() here.

import { createProviderPlugin, type ProviderPlugin } from "./provider-plugin-runtime.js";
import type { ProviderDef } from "./types.js";

export interface DefinedProvider {
  def: ProviderDef;
  plugin: ProviderPlugin;
}

export function defineProvider(def: ProviderDef): DefinedProvider {
  return {
    def,
    plugin: createProviderPlugin(def),
  };
}
