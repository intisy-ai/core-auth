// @ts-nocheck
// Public surface of the core-auth library, bundled into each provider plugin.

export { defineProvider } from "./provider.js";
export { createOpencodePlugin } from "./opencode.js";
export { listAccounts, addAccount, removeAccounts, selectAccount, saveAccounts } from "./accounts.js";
export { getConfigDir, configFolder, reposDir } from "./env.js";
export { log } from "./log.js";
export * from "./types.js";
