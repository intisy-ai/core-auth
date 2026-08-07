import { describe, it, expect, beforeEach, vi } from "vitest";

const saved: Array<{ provider: string; account: unknown }> = [];
const listeners: Array<{ closed: boolean; fire: (url: URL) => void; reject: (e: Error) => void }> = [];

vi.mock("./accounts.js", () => ({
  addAccount: (provider: string, account: unknown) => { saved.push({ provider, account }); },
}));
vi.mock("./browser.js", () => ({ openBrowser: () => {} }));
vi.mock("./ui/ansi.js", () => ({ isTTY: () => false }));
vi.mock("./server.js", () => ({
  startOAuthListener: async () => {
    let fire: (url: URL) => void = () => {};
    let reject: (e: Error) => void = () => {};
    const promise = new Promise<URL>((res, rej) => { fire = res; reject = rej; });
    const entry = { closed: false, fire, reject };
    listeners.push(entry);
    return {
      waitForCallback: () => promise,
      close: () => { entry.closed = true; },
    };
  },
}));

const { defineOAuthLogin } = await import("./oauth-login.js");

function spec(overrides: Record<string, unknown> = {}) {
  return {
    provider: "demo",
    instructions: "Sign in",
    authorize: async () => ({ url: "https://auth.example/go?x=1", verifier: "v1" }),
    exchange: async () => ({ type: "success", email: "user@example", refresh: "r-token-0123456789", access: "a", expires: 1 }),
    pastePrompt: "Paste: ",
    signInMessage: "Open this URL:",
    ...overrides,
  };
}

describe("defineOAuthLogin", () => {
  beforeEach(() => {
    saved.length = 0;
    listeners.length = 0;
  });

  it("hands back the authorize url and the provider's instructions", async () => {
    const flow = await defineOAuthLogin(spec()).loginFlow();
    expect(flow).toMatchObject({ url: "https://auth.example/go?x=1", instructions: "Sign in" });
  });

  it("saves the exchanged account to the provider's own pool", async () => {
    const flow = await defineOAuthLogin(spec()).loginFlow();
    const account = await flow.complete("the-code");
    expect(account).toMatchObject({ email: "user@example" });
    expect(saved).toEqual([{ provider: "demo", account }]);
  });

  // A bare pasted code carries no state, so the flow has to supply its own verifier or the
  // exchange is rejected as a mismatched request.
  it("rebuilds a missing state from this flow's verifier", async () => {
    const seen: string[] = [];
    const flow = await defineOAuthLogin(spec({
      exchange: async (_code: string, state: string) => { seen.push(state); return { type: "success", refresh: "r-token-0123456789" }; },
    })).loginFlow();
    await flow.complete("bare-code");
    expect(JSON.parse(Buffer.from(seen[0], "base64url").toString())).toMatchObject({ verifier: "v1" });
  });

  it("keeps a state that came back with the callback", async () => {
    const seen: string[] = [];
    const flow = await defineOAuthLogin(spec({
      exchange: async (_code: string, state: string) => { seen.push(state); return { type: "success", refresh: "r-token-0123456789" }; },
    })).loginFlow();
    await flow.complete("the-code#their-state");
    expect(seen).toEqual(["their-state"]);
  });

  // The browser callback and a paste can arrive together; exchanging a spent code twice fails
  // the second time and would report a working login as broken.
  it("completes once even when the paste and the browser both arrive", async () => {
    let exchanges = 0;
    const flow = await defineOAuthLogin(spec({
      redirectUri: "http://localhost:51121/callback",
      exchange: async () => { exchanges++; return { type: "success", refresh: "r-token-0123456789" }; },
    })).loginFlow();
    listeners[0].fire(new URL("http://localhost:51121/callback?code=abc&state=s"));
    const [viaBrowser, viaPaste] = await Promise.all([flow.loopback, flow.complete("abc")]);
    expect(exchanges).toBe(1);
    expect([viaBrowser, viaPaste].filter(Boolean)).toHaveLength(1);
  });

  it("closes the listener once the flow completes", async () => {
    const flow = await defineOAuthLogin(spec({ redirectUri: "http://localhost:51121/callback" })).loginFlow();
    await flow.complete("the-code");
    expect(listeners[0].closed).toBe(true);
  });

  it("offers no loopback for a provider that has no redirect to listen on", async () => {
    const flow = await defineOAuthLogin(spec()).loginFlow();
    expect(flow.loopback).toBeUndefined();
    expect(listeners).toHaveLength(0);
  });

  it("saves nothing when the exchange fails", async () => {
    const flow = await defineOAuthLogin(spec({ exchange: async () => ({ type: "error", error: "bad code" }) })).loginFlow();
    expect(await flow.complete("the-code")).toBeNull();
    expect(saved).toEqual([]);
  });

  it("retries the exchange once when the provider offers a second attempt", async () => {
    const attempts: string[] = [];
    const flow = await defineOAuthLogin(spec({
      begin: () => ({ via: "proxy" }),
      exchange: async (_c: string, _s: string, ctx: { via: string }) => {
        attempts.push(ctx.via);
        return ctx.via === "proxy" ? { type: "error", error: "unreachable" } : { type: "success", refresh: "r-token-0123456789" };
      },
      retry: (result: { error: string }) => (result.error === "unreachable" ? { via: "direct" } : null),
    })).loginFlow();
    expect(await flow.complete("the-code")).toBeTruthy();
    expect(attempts).toEqual(["proxy", "direct"]);
  });

  // An account upstream will not serve is worse than no account: it looks connected and every
  // request through it fails.
  it("does not save an account the provider refuses", async () => {
    const flow = await defineOAuthLogin(spec({
      accept: () => ({ ok: false, message: "not enabled for this product" }),
    })).loginFlow();
    expect(await flow.complete("the-code")).toBeNull();
    expect(saved).toEqual([]);
  });

  it("runs the provider's post-save hook with the account and its context", async () => {
    const bound: unknown[] = [];
    const flow = await defineOAuthLogin(spec({
      begin: () => ({ via: "proxy-7" }),
      onSaved: (account: { email: string }, ctx: { via: string }) => { bound.push([account.email, ctx.via]); },
    })).loginFlow();
    await flow.complete("the-code");
    expect(bound).toEqual([["user@example", "proxy-7"]]);
  });

  it("lets the provider shape the account it saves", async () => {
    const flow = await defineOAuthLogin(spec({
      toAccount: (result: { refresh: string }) => ({ id: "custom", refresh: result.refresh, meta: { projectId: "p1" } }),
    })).loginFlow();
    await flow.complete("the-code");
    expect(saved[0].account).toMatchObject({ id: "custom", meta: { projectId: "p1" } });
  });

  describe("login", () => {
    it("completes straight from a code passed on the command line", async () => {
      const lines: string[] = [];
      const account = await defineOAuthLogin(spec()).login({ code: "the-code", log: (m: string) => lines.push(m) });
      expect(account).toMatchObject({ email: "user@example" });
      expect(lines.join("\n")).toContain("Logged in as user@example");
    });

    it("throws rather than reporting success when nothing completes", async () => {
      await expect(defineOAuthLogin(spec({ exchange: async () => ({ type: "error", error: "no" }) }))
        .login({ code: "the-code", log: () => {} })).rejects.toThrow("login failed");
    });

    // Without a TTY there is nobody to paste, so the browser callback is the only way in.
    it("waits on the browser callback when there is no terminal to paste into", async () => {
      const pending = defineOAuthLogin(spec({ redirectUri: "http://localhost:51121/callback" })).login({ log: () => {} });
      await vi.waitFor(() => expect(listeners).toHaveLength(1));
      listeners[0].fire(new URL("http://localhost:51121/callback?code=abc&state=s"));
      await expect(pending).resolves.toMatchObject({ email: "user@example" });
    });
  });
});
