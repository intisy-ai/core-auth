import { describe, it, expect } from "vitest";
import { proxyFetchTarget, toProxyUrl } from "./opencode.js";

describe("proxyFetchTarget", () => {
  it("defaults to in-process handle() when the opt-in flag is unset", () => {
    expect(proxyFetchTarget({})).toEqual({ mode: "handle" });
    expect(proxyFetchTarget(undefined)).toEqual({ mode: "handle" });
  });

  it("stays in-process when the flag is any value other than exactly '1'", () => {
    expect(proxyFetchTarget({ HUB_OC_PROXY: "0" })).toEqual({ mode: "handle" });
    expect(proxyFetchTarget({ HUB_OC_PROXY: "true" })).toEqual({ mode: "handle" });
  });

  it("routes to the proxy on HUB_OC_PROXY=1, defaulting the port to 34568", () => {
    expect(proxyFetchTarget({ HUB_OC_PROXY: "1" })).toEqual({ mode: "proxy", port: 34568 });
  });

  it("honours HUB_PROXY_PORT when routing to the proxy", () => {
    expect(proxyFetchTarget({ HUB_OC_PROXY: "1", HUB_PROXY_PORT: "40000" })).toEqual({ mode: "proxy", port: 40000 });
  });

  it("degrades a non-numeric/invalid HUB_PROXY_PORT to the default rather than producing NaN", () => {
    expect(proxyFetchTarget({ HUB_OC_PROXY: "1", HUB_PROXY_PORT: "nonsense" })).toEqual({ mode: "proxy", port: 34568 });
    expect(proxyFetchTarget({ HUB_OC_PROXY: "1", HUB_PROXY_PORT: "0" })).toEqual({ mode: "proxy", port: 34568 });
  });
});

describe("toProxyUrl", () => {
  it("rewrites the origin onto the loopback daemon, preserving path and query", () => {
    expect(toProxyUrl("https://api.anthropic.com/v1/messages", 34568)).toBe("http://127.0.0.1:34568/v1/messages");
    expect(toProxyUrl("https://api.anthropic.com/v1/messages?beta=true", 34568)).toBe("http://127.0.0.1:34568/v1/messages?beta=true");
  });
});
