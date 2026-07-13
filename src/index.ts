// @ts-nocheck
// Public surface of the core-auth library, bundled into each provider plugin.

export { defineProvider } from "./provider.js";
export { createOpencodePlugin } from "./opencode.js";
export { isOAuthAuth, accessTokenExpired, calculateTokenExpiry, refreshAccessToken, TokenRefreshError } from "./oauth.js";
export { startOAuthListener } from "./server.js";
export { loadAccounts, saveAccounts, updateAccounts, listAccounts, addAccount, removeAccount, clearAccounts, LockTimeoutError } from "./accounts.js";
export { createLiveStore } from "./live-store.js";
export type { LiveStoreLike } from "./live-store.js";
export { AccountManager } from "./manager.js";
export { accountControllerFromManager } from "./controller.js";
export { isAvailable, availableAt, isLaneRateLimited, isCoolingDown, isEnabled, calculateBackoffMs } from "./ratelimit.js";
export { selectIndex } from "./selection.js";
export { getConfigDir, configFolder, reposDir } from "./env.js";
export { readConfig, writeConfig, activeProvider, setActiveProvider, getAutoConfig, setAutoConfig, getAutoCandidates } from "./config.js";
export { readModelCache, resolveProviderModels } from "./models-cache.js";
export { log } from "./log.js";
export { notify, setOpencodeClient, notifyQueuePath } from "./notify.js";
export { chatError } from "./errors.js";
export { select } from "./ui/select.js";
export { confirm } from "./ui/confirm.js";
export { prompt } from "./ui/prompt.js";
export { isTTY } from "./ui/ansi.js";
export { proxyManager, ProxyManager } from "./proxy/manager.js";
export { qualityLabel, isIpLimited, IP_LIMIT_COOLDOWN_MS, MAX_ACCOUNTS_PER_PROXY } from "./proxy/scoring.js";
export { scopeKey, parseScopeKey, effectiveMode, resolveChain, proxiesInScope, candidatesForScope } from "./proxy/scopes.js";
export { runProxyMenu, selectAccountProxies } from "./ui/proxy-menu.js";
export { runProviderMenu } from "./menu.js";
export { buildAccountMenu, buildAutoMenu } from "./ui/menu-model.js";
export { buildLoginInput } from "./ui/url-auth.js";
export { buildSettingsMenu } from "./ui/settings-menu.js";
export { openBrowser } from "./browser.js";
export { runMenu } from "./ui/menu-render.js";
export * from "./types.js";
