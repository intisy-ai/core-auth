// src/proxy/scopes.test.ts
import { describe, it, expect } from "vitest";
import { scopeKey, effectiveMode, resolveChain, candidatesForScope } from "./scopes.js";

function store(over = {}) {
  return { version: 2, modes: { default: "automatic" }, providers: {}, assignments: {}, manualSelection: {}, proxies: [], ...over };
}

describe("scopes", () => {
  it("scopeKey formats each scope type", () => {
    expect(scopeKey({ type: "global" })).toBe("global");
    expect(scopeKey({ type: "provider", id: "antigravity" })).toBe("provider:antigravity");
    expect(scopeKey({ type: "account", id: "a@b" })).toBe("account:a@b");
  });

  it("effectiveMode falls back to default", () => {
    const s = store({ modes: { default: "automatic", "global": "disabled" } });
    expect(effectiveMode(s, "global")).toBe("disabled");
    expect(effectiveMode(s, "account:x")).toBe("automatic");
  });

  it("resolveChain drops disabled scopes, most-specific first", () => {
    const s = store({ modes: { default: "automatic", "provider:p": "disabled" } });
    expect(resolveChain(s, "acc", "p")).toEqual(["account:acc", "global"]);
  });

  it("candidatesForScope excludes IP-limited + cap-bound, best-first", () => {
    const now = 1_000_000;
    const s = store({
      proxies: [
        { url: "slow", provider: "manual", scope: { type: "global" }, stats: { checks: 5, failures: 0, avgLatencyMs: 1500, ipRateLimitHits: 0 } },
        { url: "fast", provider: "manual", scope: { type: "global" }, stats: { checks: 5, failures: 0, avgLatencyMs: 100, ipRateLimitHits: 0 } },
        { url: "limited", provider: "manual", scope: { type: "global" }, stats: { lastRateLimitAt: now - 1000 } },
      ],
    });
    const urls = candidatesForScope(s, "global", "acc", now).map((p) => p.url);
    expect(urls).toEqual(["fast", "slow"]);
  });
});
