// @ts-nocheck
// The single entry a provider plugin calls. From one ProviderDef it yields both
// app integrations: `handle` for the Claude loader proxy, and `opencode` for the
// OpenCode plugin hook. The provider never touches either app directly.

import { createOpencodePlugin } from "./opencode.js";
import { log } from "./log.js";
import { getConfigDir } from "./env.js";

export function defineProvider(def) {
  return {
    def,
    handle: (request, ctx) => def.handle(request, ctx || { configDir: getConfigDir(), log }),
    opencode: createOpencodePlugin(def),
  };
}
