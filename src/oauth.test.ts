import { beforeAll, describe, it, expect } from "vitest";
import { initCoreAuth } from "./core-auth-loader.js";
import { accessTokenExpired, calculateTokenExpiry, encodeState, decodeState } from "./oauth.js";

describe("accessTokenExpired", () => {
  beforeAll(async () => {
    await initCoreAuth();
  });

  it("is false for a token expiring far in the future", () => {
    const now = Date.now();
    expect(accessTokenExpired({ access: "tok", expires: now + 60 * 60 * 1000 })).toBe(false);
  });

  it("is true for a token that already expired", () => {
    const now = Date.now();
    expect(accessTokenExpired({ access: "tok", expires: now - 1000 })).toBe(true);
  });

  it("is true within the 60s clock-skew buffer", () => {
    const now = Date.now();
    expect(accessTokenExpired({ access: "tok", expires: now + 30 * 1000 })).toBe(true);
  });

  it("is false just beyond the 60s clock-skew buffer", () => {
    const now = Date.now();
    expect(accessTokenExpired({ access: "tok", expires: now + 61 * 1000 })).toBe(false);
  });

  it("is true when access is missing", () => {
    const now = Date.now();
    expect(accessTokenExpired({ expires: now + 60 * 60 * 1000 })).toBe(true);
  });

  it("is true when expires is missing", () => {
    expect(accessTokenExpired({ access: "tok" })).toBe(true);
  });

  it("is true when expires is not a number", () => {
    expect(accessTokenExpired({ access: "tok", expires: "not-a-number" })).toBe(true);
  });

  it("is true for a null/undefined auth object", () => {
    expect(accessTokenExpired(null)).toBe(true);
    expect(accessTokenExpired(undefined)).toBe(true);
  });
});

describe("encodeState/decodeState", () => {
  it("round-trips a payload carrying the PKCE verifier plus extra fields", () => {
    const state = encodeState({ verifier: "abc", foo: "bar" });
    expect(decodeState(state)).toEqual({ verifier: "abc", foo: "bar" });
  });

  it("throws when the decoded payload has no PKCE verifier", () => {
    const state = encodeState({ foo: "bar" });
    expect(() => decodeState(state)).toThrow(/Missing PKCE verifier/);
  });
});

// The expiry maths runs in Java (OAuthWire), shared by the refresh and the code exchange, so these
// pin what crosses the boundary: a non-number becomes NaN, which the engine reads as "absent".
describe("calculateTokenExpiry", () => {
  it("adds the reported lifetime in milliseconds", () => {
    expect(calculateTokenExpiry(1_000_000, 1800)).toBe(1_000_000 + 1800 * 1000);
  });

  it("defaults to an hour when the endpoint reported no expires_in", () => {
    expect(calculateTokenExpiry(1_000_000, undefined)).toBe(1_000_000 + 3600 * 1000);
    expect(calculateTokenExpiry(1_000_000, "not-a-number" as unknown as number)).toBe(1_000_000 + 3600 * 1000);
  });

  it("collapses a non-positive lifetime to the request time, so the token reads as expired", () => {
    expect(calculateTokenExpiry(1_000_000, 0)).toBe(1_000_000);
    expect(calculateTokenExpiry(1_000_000, -5)).toBe(1_000_000);
  });
});
