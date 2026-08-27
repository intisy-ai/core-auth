// Public surface of the core-auth library, bundled into each provider plugin.

export { defineProvider } from "./provider.js";
export type { DefinedProvider } from "./provider.js";
export { defineProviderPlugin } from "./provider-plugin.js";
export type { ProviderPluginOpts } from "./provider-plugin.js";
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
export type { RetryBackoffKeys, RetryBackoffDefaults, AccountSelectionStrategy } from "./provider-common.js";
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
export { createProviderPlugin, dispatchFetch } from "./provider-plugin-runtime.js";
export type { ProviderPlugin } from "./provider-plugin-runtime.js";
export { descriptorFor, providerCapability } from "./provider-capability.js";
export { PROVIDER_SUPPORT, providerSupport } from "./provider-support.js";
export type { ProviderSupport } from "./provider-support.js";
export type { ExtraLanes, Provider, ProviderDescriptor } from "./provider-capability.js";
export { PROVIDER } from "./generated/auth-contracts.keys.js";
export { resolveAppFrontDoor } from "./frontdoor.js";
export type { AppFrontDoor, FrontDoorToolkit } from "./frontdoor.js";
export { isOAuthAuth, accessTokenExpired, calculateTokenExpiry, encodeState, decodeState, refreshAccessToken, TokenRefreshError } from "./oauth.js";
export type { RefreshedToken, RefreshAccessTokenOpts, TokenRefreshErrorOptions, DecodedState } from "./oauth.js";
export { startOAuthListener } from "./server.js";
export type { OAuthListener, StartOAuthListenerOptions } from "./server.js";
export { loadAccounts, saveAccounts, updateAccounts, listAccounts, addAccount, removeAccount, clearAccounts, LockTimeoutError } from "./accounts.js";
export type { AccountStoreLocation } from "./accounts.js";
export { createLiveStore } from "./live-store.js";
export type { LiveStoreLike, LiveStoreOpts } from "./live-store.js";
export { AccountManager } from "./manager.js";
export type { AccountManagerOptions, AccountManagerBackoff } from "./manager.js";
export { accountControllerFromManager, refreshAccountToken, verifyAllAccounts } from "./controller.js";
export type { AccountManagerLike, AccountControllerOptions } from "./controller.js";
export { isCoolingDown } from "./ratelimit.js";
export { hasCapacity, ipSuspected } from "./quota-health.js";
export type { QuotaPool } from "./quota-health.js";
export { getConfigDir, configFolder, reposDir, cacheDir } from "./env.js";
export { readConfig, writeConfig, activeProvider, setActiveProvider, getAutoConfig, setAutoConfig, getAutoCandidates } from "./config.js";
export { readModelCache, resolveProviderModels } from "./models-cache.js";
export type { ModelCacheEntry } from "./models-cache.js";
export { log } from "./log.js";
export { notify, setAppClient, setNotifier, notifyQueuePath } from "./notify.js";
export type { NotifyLevel } from "./notify.js";
export { setActivityEmitter } from "./activity.js";
export { chatError, HandleIrError, handleIrErrorFromResponse } from "./errors.js";
export type { ChatErrorOptions } from "./errors.js";
export { lazyModule, safeJsonParse } from "./lazy.js";
export type { LazyModule } from "./lazy.js";
export { select } from "./ui/select.js";
export type { SelectItem, SelectOptions, SelectItemColor, SelectItemKind } from "./ui/select.js";
export { confirm } from "./ui/confirm.js";
export { prompt } from "./ui/prompt.js";
export { isTTY } from "./ui/ansi.js";
export { proxyManager, ProxyManager } from "./proxy/manager.js";
export type { ScoredProxyEntry, ReportRateLimitOpts, ProxyEntry, ProxyScope, ProxyStore, ProxyStats } from "./proxy/manager.js";
export { proxiedFetch, timeoutFetch } from "./net.js";
export type { ProxyManagerLike, ProxiedFetchOpts, ProxiedFetchResult } from "./net.js";
export { qualityLabel, isIpLimited, IP_LIMIT_COOLDOWN_MS, MAX_ACCOUNTS_PER_PROXY } from "./proxy/scoring.js";
export { scopeKey, parseScopeKey, effectiveMode, resolveChain, proxiesInScope, candidatesForScope } from "./proxy/scopes.js";
export type { ProxyProviderConfig } from "./proxy/providers.js";
export { runProxyMenu, selectAccountProxies } from "./ui/proxy-menu.js";
export { runProviderMenu } from "./menu.js";
export { providerHandlerExports } from "./handler-exports.js";
export type { ProviderHandlerExports } from "./handler-exports.js";
export { buildAccountMenu, buildAutoMenu } from "./ui/menu-model.js";
export type { AccountMenu, AccountMenuItem, AccountMenuInput, AccountMenuNavigation } from "./ui/menu-model.js";
export { buildLoginInput } from "./ui/url-auth.js";
export { buildSettingsMenu } from "./ui/settings-menu.js";
export type { SettingsMenuDef } from "./ui/settings-menu.js";
export { openBrowser } from "./browser.js";
export { parsePastedCallback, awaitPaste, toCoreAccount, oauthConfigFor } from "./login.js";
export type { OauthConfig, OauthConfigInput, PastedCallback, AwaitPasteDeps, OauthExchangeResult } from "./login.js";
export { defineOAuthLogin } from "./oauth-login.js";
export type { OAuthLoginSpec, OAuthLoginFlowHandle, OAuthLoginOpts, OAuthAcceptVerdict, OAuthAuthorization, OAuthExchangeOutcome } from "./oauth-login.js";
export { runMenu } from "./ui/menu-render.js";
export { runAccountCli, printAccounts } from "./account-cli.js";
export type { AccountCliDriver, AccountCliLoginOpts, RunAccountCliOpts } from "./account-cli.js";
export { initCoreAuth, getCoreAuth } from "./core-auth-loader.js";
export * from "./types.js";
