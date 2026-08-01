import { describe, it, expect } from "vitest";
import { Readable, PassThrough } from "node:stream";
import { parsePastedCallback, toCoreAccount, oauthConfigFor, awaitPaste } from "./login.js";

describe("parsePastedCallback", () => {
  it("parses code and state out of a full redirect URL", () => {
    const url = "http://localhost:51121/callback?code=abc123&state=xyz789";
    expect(parsePastedCallback(url)).toEqual({ code: "abc123", state: "xyz789" });
  });

  it("url-decodes code and state", () => {
    const url = "http://localhost/callback?code=a%2Fb&state=s%3D1";
    expect(parsePastedCallback(url)).toEqual({ code: "a/b", state: "s=1" });
  });

  it("tolerates a full URL with no state param", () => {
    const url = "http://localhost/callback?code=abc123";
    expect(parsePastedCallback(url)).toEqual({ code: "abc123", state: null });
  });

  it("parses a code#state pasted pair", () => {
    expect(parsePastedCallback("abc123#xyz789")).toEqual({ code: "abc123", state: "xyz789" });
  });

  it("treats a bare code with no # or query as code-only", () => {
    expect(parsePastedCallback("just-a-bare-code")).toEqual({ code: "just-a-bare-code", state: null });
  });

  it("trims surrounding whitespace", () => {
    expect(parsePastedCallback("  abc123  \n")).toEqual({ code: "abc123", state: null });
  });

  it("returns null for empty or whitespace-only input", () => {
    expect(parsePastedCallback("")).toBeNull();
    expect(parsePastedCallback("   ")).toBeNull();
  });
});

describe("toCoreAccount", () => {
  it("builds the shared account shape from resolved tokens", () => {
    const before = Date.now();
    const account = toCoreAccount({
      email: "user@example.com",
      refresh: "refresh-token",
      access: "access-token",
      expires: 12345,
    });
    expect(account.id).toBe("user@example.com");
    expect(account.email).toBe("user@example.com");
    expect(account.refresh).toBe("refresh-token");
    expect(account.access).toBe("access-token");
    expect(account.expires).toBe(12345);
    expect(account.enabled).toBe(true);
    expect(account.lastUsed).toBe(0);
    expect(account.rateLimitResetTimes).toEqual({});
    expect(account.meta).toEqual({});
    expect(account.addedAt).toBeGreaterThanOrEqual(before);
  });

  it("falls back to the first 16 chars of the refresh token when there is no email", () => {
    const account = toCoreAccount({ refresh: "0123456789abcdefghij" });
    expect(account.id).toBe("0123456789abcdef");
    expect(account.email).toBeUndefined();
  });
});

describe("oauthConfigFor", () => {
  it("assembles tokenUrl + clientId, omitting clientSecret when absent", () => {
    const config = oauthConfigFor({ clientId: "client-abc", tokenUrl: "https://example.com/token" });
    expect(config).toEqual({ tokenUrl: "https://example.com/token", clientId: "client-abc" });
    expect(config).not.toHaveProperty("clientSecret");
  });

  it("includes clientSecret when provided", () => {
    const config = oauthConfigFor({
      clientId: "client-abc",
      clientSecret: "shh",
      tokenUrl: "https://example.com/token",
    });
    expect(config).toEqual({
      tokenUrl: "https://example.com/token",
      clientId: "client-abc",
      clientSecret: "shh",
    });
  });
});

describe("awaitPaste", () => {
  it("resolves with the line entered on the injected input stream", async () => {
    const input = Readable.from(["pasted-value\n"]);
    const output = new PassThrough();
    output.resume();
    const answer = await awaitPaste("Paste here: ", { input, output });
    expect(answer).toBe("pasted-value");
  });
});
