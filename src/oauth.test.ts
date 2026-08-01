import { beforeAll, describe, it, expect } from "vitest";
import { initCoreAuth } from "./core-auth-loader.js";
import { accessTokenExpired, encodeState, decodeState } from "./oauth.js";

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
