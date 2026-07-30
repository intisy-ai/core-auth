import { describe, it, expect } from "vitest";
import { COMMON_PROVIDER_DEFAULTS, COMMON_PROVIDER_CAPABILITIES, commonManagerOptions } from "./provider-common.js";

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
});
