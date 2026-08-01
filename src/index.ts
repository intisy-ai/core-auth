// @ts-nocheck
// Public surface of the core-auth library, bundled into each provider plugin.

export { defineProvider } from "./provider.js";
export { defineProviderPlugin } from "./provider-plugin.js";
export type { ProviderPluginOpts, ProviderPluginCore, OpencodePlugin } from "./provider-plugin.js";
export {
  COMMON_PROVIDER_DEFAULTS,
  COMMON_PROVIDER_CAPABILITIES,
  commonManagerOptions,
  retryBackoffCapabilities,
  retryBackoffSettingsGroups,
  retryBackoffConfigDefaults,
  coercePositiveInt,
  coerceRetryBackoff,
  retryBackoffMs,
} from "./provider-common.js";
export type { RetryBackoffKeys, RetryBackoffDefaults } from "./provider-common.js";
export {
  toSettingsGroups,
  toCapabilitiesFields,
} from "./settings-schema.js";
export type {
  ProviderSettingsSchema,
  SettingsGroupSchema,
  SettingsField,
  SettingsFieldType,
  SettingsFieldOption,
  SettingsMenuGroup,
  SettingsMenuField,
  CapabilitiesField,
} from "./settings-schema.js";
export { createOpencodePlugin } from "./opencode.js";
export { isOAuthAuth, accessTokenExpired, calculateTokenExpiry, encodeState, decodeState, refreshAccessToken, TokenRefreshError } from "./oauth.js";
export { startOAuthListener } from "./server.js";
export { loadAccounts, saveAccounts, updateAccounts, listAccounts, addAccount, removeAccount, clearAccounts, LockTimeoutError } from "./accounts.js";
export { createLiveStore } from "./live-store.js";
export type { LiveStoreLike } from "./live-store.js";
export { AccountManager } from "./manager.js";
export { accountControllerFromManager, refreshAccountToken, verifyAllAccounts } from "./controller.js";
export { isCoolingDown } from "./ratelimit.js";
export { hasCapacity, ipSuspected } from "./quota-health.js";
export type { QuotaPool } from "./quota-health.js";
export { getConfigDir, configFolder, reposDir } from "./env.js";
export { readConfig, writeConfig, activeProvider, setActiveProvider, getAutoConfig, setAutoConfig, getAutoCandidates } from "./config.js";
export { readModelCache, resolveProviderModels } from "./models-cache.js";
export { log } from "./log.js";
export { notify, setOpencodeClient, setNotifier, notifyQueuePath } from "./notify.js";
export { chatError, HandleIrError, handleIrErrorFromResponse } from "./errors.js";
export { lazyModule, safeJsonParse } from "./lazy.js";
export type { LazyModule } from "./lazy.js";
export { select } from "./ui/select.js";
export { confirm } from "./ui/confirm.js";
export { prompt } from "./ui/prompt.js";
export { isTTY } from "./ui/ansi.js";
export { proxyManager, ProxyManager } from "./proxy/manager.js";
export { proxiedFetch, timeoutFetch } from "./net.js";
export type { ProxyManagerLike, ProxiedFetchOpts, ProxiedFetchResult } from "./net.js";
export { qualityLabel, isIpLimited, IP_LIMIT_COOLDOWN_MS, MAX_ACCOUNTS_PER_PROXY } from "./proxy/scoring.js";
export { scopeKey, parseScopeKey, effectiveMode, resolveChain, proxiesInScope, candidatesForScope } from "./proxy/scopes.js";
export { runProxyMenu, selectAccountProxies } from "./ui/proxy-menu.js";
export { runProviderMenu } from "./menu.js";
export { providerHandlerExports } from "./handler-exports.js";
export { buildAccountMenu, buildAutoMenu } from "./ui/menu-model.js";
export { buildLoginInput } from "./ui/url-auth.js";
export { buildSettingsMenu } from "./ui/settings-menu.js";
export { openBrowser } from "./browser.js";
export { parsePastedCallback, awaitPaste, toCoreAccount, oauthConfigFor } from "./login.js";
export { runMenu } from "./ui/menu-render.js";
export { runAccountCli, printAccounts } from "./account-cli.js";
export type { AccountCliDriver, AccountCliLoginOpts, RunAccountCliOpts } from "./account-cli.js";
export { initCoreAuth, getCoreAuth } from "./core-auth-loader.js";
export * from "./types.js";
