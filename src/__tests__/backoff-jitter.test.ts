import { describe, expect, it } from "vitest";
import { getCoreAuth } from "../core-auth-loader.js";

// Regression coverage for the CoreAuthJs bridge itself: calculateBackoffMsJson has no TS
// wrapper anywhere in this repo, so nothing exercised the jitter:true path before this, and
// that gap hid a bug where the bridge called the RateLimitMath overload that ignores jitter
// entirely, always returning the exact halved value instead of a randomized one.
describe("calculateBackoffMsJson", () => {
  const argsJson = (jitter: boolean) => JSON.stringify({ attempt: 3, baseMs: 1000, maxMs: 60000, jitter });

  it("jitter:false returns the exact exponential-backoff value", () => {
    const result = JSON.parse(getCoreAuth().calculateBackoffMsJson(argsJson(false)));
    expect(result).toBe(8000);
  });

  it("jitter:true randomizes within [raw/2, raw) instead of always returning raw/2", () => {
    const results = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const value = JSON.parse(getCoreAuth().calculateBackoffMsJson(argsJson(true)));
      expect(value).toBeGreaterThanOrEqual(4000);
      expect(value).toBeLessThan(8000);
      results.add(value);
    }
    expect(results.size).toBeGreaterThan(1);
  });
});
