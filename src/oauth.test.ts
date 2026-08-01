import { describe, it, expect } from "vitest";
import { encodeState, decodeState } from "./oauth.js";

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
