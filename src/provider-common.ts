// @ts-nocheck
// Settings that belong to EVERY core-auth provider, declared once here instead of
// hand-duplicated in each provider. Right now that is the account-selection
// strategy: the AccountManager consumes it identically for every provider, so a
// dashboard can control it for any provider without knowing which one it is.
// Providers spread these into their own defineConfig / defineCapabilities and pass
// commonManagerOptions() to AccountManager, so the key name, default, and choice
// list live in one place.

export const COMMON_PROVIDER_DEFAULTS = {
  account_selection_strategy: "hybrid",
};

export const COMMON_PROVIDER_CAPABILITIES = [
  {
    key: "account_selection_strategy",
    type: "select",
    label: "Account selection",
    description: "How accounts are picked: sticky keeps the prompt cache warm, round-robin spreads load, hybrid balances by availability.",
    group: "Account selection",
    options: [
      { value: "hybrid", label: "Hybrid (health + freshness)" },
      { value: "sticky", label: "Sticky (until rate-limited)" },
      { value: "round-robin", label: "Round-robin" },
    ],
  },
];

// AccountManager options derived from the common settings, so no provider hardcodes
// the config key or the default strategy at its construction site. Providers merge
// their own opts (oauth, backoff, isAvailable) on top.
export function commonManagerOptions(config) {
  const cfg = config || {};
  return { selection: cfg.account_selection_strategy || "hybrid" };
}
