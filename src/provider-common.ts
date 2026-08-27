// Settings that belong to EVERY core-auth provider, declared once here instead of
// hand-duplicated in each provider. Right now that is the account-selection
// strategy: the AccountManager consumes it identically for every provider, so a
// dashboard can control it for any provider without knowing which one it is.
// Providers spread these into their own defineConfig / defineCapabilities and pass
// commonManagerOptions() to AccountManager, so the key name, default, and choice
// list live in one place.

import { toCapabilitiesFields, toSettingsGroups, type ProviderSettingsSchema } from "./settings-schema.js";

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

// Matches this file's own select options (COMMON_PROVIDER_CAPABILITIES above) and
// the Java Strategy enum (ROUND_ROBIN, STICKY, HYBRID) one to one.
export type AccountSelectionStrategy = "hybrid" | "sticky" | "round-robin";

function isAccountSelectionStrategy(value: unknown): value is AccountSelectionStrategy {
  return value === "hybrid" || value === "sticky" || value === "round-robin";
}

// AccountManager options derived from the common settings, so no provider hardcodes
// the config key or the default strategy at its construction site. Providers merge
// their own opts (oauth, backoff, isAvailable) on top.
export function commonManagerOptions(config?: Record<string, unknown>): { selection: AccountSelectionStrategy } {
  const cfg = config || {};
  const strategy = cfg.account_selection_strategy;
  return { selection: isAccountSelectionStrategy(strategy) ? strategy : "hybrid" };
}

// Retry/backoff: same "base cooldown, doubles per attempt, capped at a max"
// semantics across providers (antigravity's default_retry_after_seconds/
// max_backoff_seconds, claude-code's default_cooldown_seconds/max_cooldown_seconds),
// but the KEY NAMES differ per provider and renaming them would silently drop a
// live user's existing config value. So provider-common owns the field shape,
// the coercion, and the AccountManager-ready backoff object; each provider
// supplies its OWN key names (RetryBackoffKeys) and its OWN default values
// (RetryBackoffDefaults) - antigravity's 60/60 and claude-code's 60/900 are
// legitimate per-provider config values, not duplication.

export interface RetryBackoffKeys {
  baseKey: string;
  maxKey: string;
}

export interface RetryBackoffDefaults {
  baseSeconds: number;
  maxSeconds: number;
}

function retryBackoffSchema(keys: RetryBackoffKeys): ProviderSettingsSchema {
  return [
    {
      title: "Retry",
      fields: [
        { key: keys.baseKey, label: "Base retry delay (s)", type: "number", min: 1, hint: "Base cooldown after a rate limit or transient error; doubles per attempt." },
        { key: keys.maxKey, label: "Max backoff (s)", type: "number", min: 1, hint: "Caps how long the exponential backoff can grow." },
      ],
    },
  ];
}

// Ready-to-spread capabilities fields (Cairn dashboard) for a provider's retry/backoff
// pair, generated from the one schema above via the settings-schema adapter.
export function retryBackoffCapabilities(keys: RetryBackoffKeys) {
  return toCapabilitiesFields(retryBackoffSchema(keys));
}

// Ready-to-use settings.groups (loader TUI) for a provider's retry/backoff pair,
// generated from the same schema.
export function retryBackoffSettingsGroups(keys: RetryBackoffKeys) {
  return toSettingsGroups(retryBackoffSchema(keys));
}

// Default config values keyed by the provider's own key names.
export function retryBackoffConfigDefaults(keys: RetryBackoffKeys, defaults: RetryBackoffDefaults) {
  return { [keys.baseKey]: defaults.baseSeconds, [keys.maxKey]: defaults.maxSeconds };
}

// Validates a raw config value into a positive integer, falling back to the
// default on anything non-finite or below the minimum (matches the existing
// per-provider "isFinite && >= 1 ? floor : default" coercion, not a clamp).
export function coercePositiveInt(value: unknown, defaultValue: number, min = 1): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : defaultValue;
}

// Coerces a provider's raw retry/backoff config into validated seconds, reading
// the provider's own key names and falling back to the provider's own defaults.
export function coerceRetryBackoff(config: Record<string, unknown> | undefined, keys: RetryBackoffKeys, defaults: RetryBackoffDefaults): RetryBackoffDefaults {
  const cfg = config || {};
  return {
    baseSeconds: coercePositiveInt(cfg[keys.baseKey], defaults.baseSeconds),
    maxSeconds: coercePositiveInt(cfg[keys.maxKey], defaults.maxSeconds),
  };
}

// AccountManager-ready backoff object ({baseMs, maxMs}), matching the shape
// antigravity's driver constructs by hand today.
export function retryBackoffMs(config: Record<string, unknown> | undefined, keys: RetryBackoffKeys, defaults: RetryBackoffDefaults) {
  const coerced = coerceRetryBackoff(config, keys, defaults);
  return { baseMs: coerced.baseSeconds * 1000, maxMs: coerced.maxSeconds * 1000 };
}
