// Settings that belong to EVERY core-auth provider, declared once here instead of
// hand-duplicated in each provider. Right now that is the account-selection
// strategy: the AccountManager consumes it identically for every provider, so a
// dashboard can control it for any provider without knowing which one it is.
// Providers spread these into their own defineConfig / defineCapabilities and pass
// commonManagerOptions() to AccountManager, so the key name, default, and choice
// list live in one place.

import { toCapabilitiesFields, toSettingsGroups, type ProviderSettingsSchema, type CapabilitiesField } from "./settings-schema.js";

/** Default value for the account-selection config key every provider spreads into its own defineConfig. */
export const COMMON_PROVIDER_DEFAULTS: {
  /** Default selection strategy. */
  account_selection_strategy: AccountSelectionStrategy;
} = {
  account_selection_strategy: "hybrid",
};

/** Capabilities-fields entry for the account-selection setting, spread into a provider's own defineCapabilities. */
export const COMMON_PROVIDER_CAPABILITIES: CapabilitiesField[] = [
  {
    /** The config key this field reads and writes. */
    key: "account_selection_strategy",
    /** The edit widget. */
    type: "select",
    /** Display label. */
    label: "Account selection",
    /** Help text shown alongside the field. */
    description: "How accounts are picked: sticky keeps the prompt cache warm, round-robin spreads load, hybrid balances by availability.",
    /** Group heading. */
    group: "Account selection",
    /** The selectable strategies. */
    options: [
      {
        /** The stored value. */
        value: "hybrid",
        /** Display text. */
        label: "Hybrid (health + freshness)",
      },
      { value: "sticky", label: "Sticky (until rate-limited)" },
      { value: "round-robin", label: "Round-robin" },
    ],
  },
];

/**
 * How the AccountManager picks which account serves the next request.
 *
 * @remarks
 * Matches this file's own select options ({@link COMMON_PROVIDER_CAPABILITIES}) and the Java
 * Strategy enum (ROUND_ROBIN, STICKY, HYBRID) one to one.
 */
export type AccountSelectionStrategy = "hybrid" | "sticky" | "round-robin";

function isAccountSelectionStrategy(value: unknown): value is AccountSelectionStrategy {
  return value === "hybrid" || value === "sticky" || value === "round-robin";
}

/**
 * Derives the AccountManager's selection option from a provider's config, so no provider
 * hardcodes the config key or the default strategy at its own construction site.
 *
 * @param config the provider's raw config; an unrecognized or missing strategy falls back to `"hybrid"`
 * @returns the option to merge into the provider's own AccountManager options (oauth, backoff, isAvailable)
 */
export function commonManagerOptions(config?: Record<string, unknown>): {
  /** The resolved selection strategy. */
  selection: AccountSelectionStrategy;
} {
  const cfg = config || {};
  const strategy = cfg.account_selection_strategy;
  return { selection: isAccountSelectionStrategy(strategy) ? strategy : "hybrid" };
}

/**
 * A provider's own config key names for its base and max retry-backoff settings.
 *
 * @remarks
 * Every provider shares the same "base cooldown, doubles per attempt, capped at a max"
 * semantics, but the key names differ per provider (antigravity's
 * `default_retry_after_seconds`/`max_backoff_seconds`, claude-code's
 * `default_cooldown_seconds`/`max_cooldown_seconds`), and renaming them would silently drop a
 * live user's existing config value. This lets provider-common own the field shape, the
 * coercion, and the AccountManager-ready backoff object while each provider keeps its own names.
 */
export interface RetryBackoffKeys {
  /** The provider's own config key for the base retry delay. */
  baseKey: string;
  /** The provider's own config key for the max backoff. */
  maxKey: string;
}

/** A provider's own default base and max retry-backoff values, in seconds. */
export interface RetryBackoffDefaults {
  /** Base cooldown, in seconds. */
  baseSeconds: number;
  /** Cap on the exponential backoff, in seconds. */
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

/** Capabilities fields (Cairn dashboard) for a provider's retry/backoff pair, keyed by its own field names. */
export function retryBackoffCapabilities(keys: RetryBackoffKeys) {
  return toCapabilitiesFields(retryBackoffSchema(keys));
}

/** Settings groups (loader TUI) for a provider's retry/backoff pair, keyed by its own field names. */
export function retryBackoffSettingsGroups(keys: RetryBackoffKeys) {
  return toSettingsGroups(retryBackoffSchema(keys));
}

/** Default config values for a provider's retry/backoff pair, keyed by the provider's own field names. */
export function retryBackoffConfigDefaults(keys: RetryBackoffKeys, defaults: RetryBackoffDefaults) {
  return { [keys.baseKey]: defaults.baseSeconds, [keys.maxKey]: defaults.maxSeconds };
}

/**
 * Coerces a raw config value into a positive integer.
 *
 * @param value the raw config value
 * @param defaultValue used when `value` is non-finite or below `min`
 * @param min the smallest accepted value, 1 by default
 */
export function coercePositiveInt(value: unknown, defaultValue: number, min = 1): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : defaultValue;
}

/**
 * Coerces a provider's raw retry/backoff config into validated seconds, reading the provider's
 * own key names and falling back to the provider's own defaults.
 */
export function coerceRetryBackoff(config: Record<string, unknown> | undefined, keys: RetryBackoffKeys, defaults: RetryBackoffDefaults): RetryBackoffDefaults {
  const cfg = config || {};
  return {
    baseSeconds: coercePositiveInt(cfg[keys.baseKey], defaults.baseSeconds),
    maxSeconds: coercePositiveInt(cfg[keys.maxKey], defaults.maxSeconds),
  };
}

/**
 * AccountManager-ready backoff object (`{baseMs, maxMs}`), coerced from a provider's raw config.
 */
export function retryBackoffMs(config: Record<string, unknown> | undefined, keys: RetryBackoffKeys, defaults: RetryBackoffDefaults): {
  /** Base cooldown, in milliseconds. */
  baseMs: number;
  /** Cap on the exponential backoff, in milliseconds. */
  maxMs: number;
} {
  const coerced = coerceRetryBackoff(config, keys, defaults);
  return { baseMs: coerced.baseSeconds * 1000, maxMs: coerced.maxSeconds * 1000 };
}
