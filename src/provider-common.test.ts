import { describe, it, expect } from "vitest";
import {
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

const ANTIGRAVITY_KEYS = { baseKey: "default_retry_after_seconds", maxKey: "max_backoff_seconds" };
const CLAUDE_KEYS = { baseKey: "default_cooldown_seconds", maxKey: "max_cooldown_seconds" };

describe("common provider settings", () => {
  it("defaults the selection strategy to hybrid", () => {
    expect(COMMON_PROVIDER_DEFAULTS.account_selection_strategy).toBe("hybrid");
  });

  it("declares account_selection_strategy as a select over the three engine strategies", () => {
    const field = COMMON_PROVIDER_CAPABILITIES.find((f) => f.key === "account_selection_strategy");
    expect(field).toBeTruthy();
    expect(field.type).toBe("select");
    expect(field.options.map((o) => o.value).sort()).toEqual(["hybrid", "round-robin", "sticky"]);
  });

  it("maps the config value to the AccountManager selection option", () => {
    expect(commonManagerOptions({ account_selection_strategy: "sticky" })).toEqual({ selection: "sticky" });
  });

  it("falls back to hybrid when the strategy is missing", () => {
    expect(commonManagerOptions({}).selection).toBe("hybrid");
    expect(commonManagerOptions(undefined).selection).toBe("hybrid");
  });

  it("falls back to hybrid when the strategy is an empty string", () => {
    expect(commonManagerOptions({ account_selection_strategy: "" }).selection).toBe("hybrid");
  });
});

describe("retry/backoff shared schema", () => {
  it("uses each provider's own key names for the capabilities fields", () => {
    const antigravity = retryBackoffCapabilities(ANTIGRAVITY_KEYS);
    const claude = retryBackoffCapabilities(CLAUDE_KEYS);
    expect(antigravity.map((f) => f.key)).toEqual(["default_retry_after_seconds", "max_backoff_seconds"]);
    expect(claude.map((f) => f.key)).toEqual(["default_cooldown_seconds", "max_cooldown_seconds"]);
  });

  it("emits the same key set in both vocabularies for the same provider keys", () => {
    const capsKeys = retryBackoffCapabilities(ANTIGRAVITY_KEYS).map((f) => f.key).sort();
    const groupsKeys = retryBackoffSettingsGroups(ANTIGRAVITY_KEYS).flatMap((g) => g.fields.map((f) => f.key)).sort();
    expect(capsKeys).toEqual(groupsKeys);
  });

  it("keeps each provider's own default VALUES (60/60 vs 60/900), not a shared default", () => {
    const antigravityDefaults = retryBackoffConfigDefaults(ANTIGRAVITY_KEYS, { baseSeconds: 60, maxSeconds: 60 });
    const claudeDefaults = retryBackoffConfigDefaults(CLAUDE_KEYS, { baseSeconds: 60, maxSeconds: 900 });
    expect(antigravityDefaults).toEqual({ default_retry_after_seconds: 60, max_backoff_seconds: 60 });
    expect(claudeDefaults).toEqual({ default_cooldown_seconds: 60, max_cooldown_seconds: 900 });
  });

  it("coercePositiveInt falls back to the default on non-finite or sub-minimum values", () => {
    expect(coercePositiveInt(30, 60)).toBe(30);
    expect(coercePositiveInt("45", 60)).toBe(45);
    expect(coercePositiveInt(0, 60)).toBe(60);
    expect(coercePositiveInt(-5, 60)).toBe(60);
    expect(coercePositiveInt(NaN, 60)).toBe(60);
    expect(coercePositiveInt(undefined, 60)).toBe(60);
    expect(coercePositiveInt(12.9, 60)).toBe(12);
  });

  it("coerceRetryBackoff reads a provider's own keys and falls back to that provider's own defaults", () => {
    const claudeDefaults = { baseSeconds: 60, maxSeconds: 900 };
    expect(coerceRetryBackoff({ default_cooldown_seconds: 30, max_cooldown_seconds: 600 }, CLAUDE_KEYS, claudeDefaults))
      .toEqual({ baseSeconds: 30, maxSeconds: 600 });
    expect(coerceRetryBackoff({}, CLAUDE_KEYS, claudeDefaults)).toEqual(claudeDefaults);
    expect(coerceRetryBackoff(undefined, CLAUDE_KEYS, claudeDefaults)).toEqual(claudeDefaults);
  });

  it("retryBackoffMs converts the coerced seconds into an AccountManager-ready {baseMs,maxMs}", () => {
    const antigravityDefaults = { baseSeconds: 60, maxSeconds: 60 };
    expect(retryBackoffMs({}, ANTIGRAVITY_KEYS, antigravityDefaults)).toEqual({ baseMs: 60000, maxMs: 60000 });
    expect(retryBackoffMs({ default_retry_after_seconds: 5, max_backoff_seconds: 30 }, ANTIGRAVITY_KEYS, antigravityDefaults))
      .toEqual({ baseMs: 5000, maxMs: 30000 });
  });
});
