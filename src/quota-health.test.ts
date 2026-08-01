import { beforeAll, describe, expect, it } from "vitest";
import { initCoreAuth } from "./core-auth-loader.js";
import { hasCapacity, ipSuspected } from "./quota-health.js";

describe("quota-health SPI", () => {
  beforeAll(async () => {
    await initCoreAuth();
  });

  it("has capacity when at least one pool is not fully utilized", () => {
    const pools = [{ remainingFraction: 0.5 }, { remainingFraction: 0 }];
    expect(hasCapacity(pools)).toBe(true);
    expect(ipSuspected(pools)).toBe(true);
  });

  it("has no capacity when every pool is exhausted", () => {
    const pools = [{ remainingFraction: 0 }, { remainingFraction: 0 }];
    expect(hasCapacity(pools)).toBe(false);
    expect(ipSuspected(pools)).toBe(false);
  });

  it("has no capacity for an empty pool list", () => {
    expect(hasCapacity([])).toBe(false);
    expect(ipSuspected([])).toBe(false);
  });

  it("has capacity at the boundary: one nonzero pool among zeros", () => {
    const pools = [{ remainingFraction: 0 }, { remainingFraction: 0 }, { remainingFraction: 0.01 }];
    expect(hasCapacity(pools)).toBe(true);
  });
});
