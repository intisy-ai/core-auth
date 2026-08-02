import { describe, it, expect, vi, afterEach } from "vitest";
import { proxyFetchTarget, toProxyUrl, dispatchOpencodeFetch } from "./opencode-fetch.js";

const ctx = { configDir: "/tmp", log: () => {} };
const req = () => new Request("https://api.vendor.example/v1/messages", { method: "POST", body: "{}" });

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
  it("honours HUB_PROXY_PORT and degrades a bad value to the default", () => {
    expect(proxyFetchTarget({ HUB_OC_PROXY: "1", HUB_PROXY_PORT: "40000" })).toEqual({ mode: "proxy", port: 40000 });
    expect(proxyFetchTarget({ HUB_OC_PROXY: "1", HUB_PROXY_PORT: "nonsense" })).toEqual({ mode: "proxy", port: 34568 });
    expect(proxyFetchTarget({ HUB_OC_PROXY: "1", HUB_PROXY_PORT: "0" })).toEqual({ mode: "proxy", port: 34568 });
  });
});

describe("toProxyUrl", () => {
  it("rewrites the origin onto the loopback daemon, preserving path and query", () => {
    expect(toProxyUrl("https://api.vendor.example/v1/messages?beta=true", 34568)).toBe("http://127.0.0.1:34568/v1/messages?beta=true");
  });
});

describe("dispatchOpencodeFetch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("proxy mode forwards to the daemon (no translator needed, it is an HTTP forward)", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (r: Request) => { seen.push(r.url); return new Response("forwarded", { status: 200 }); }));
    const res = await dispatchOpencodeFetch({ id: "p" }, req(), { HUB_OC_PROXY: "1" }, ctx);
    expect(await res.text()).toBe("forwarded");
    expect(seen[0]).toBe("http://127.0.0.1:34568/v1/messages");
  });

  it("direct mode calls the provider's injected serveDirect with def.handleIr", async () => {
    let sawHandleIr: unknown = null;
    const handleIr = async () => ({}) as any;
    const def = { id: "p", handleIr, serveDirect: async (_r: Request, h: unknown) => { sawHandleIr = h; return new Response("direct", { status: 200 }); } };
    const res = await dispatchOpencodeFetch(def, req(), {}, ctx);
    expect(await res.text()).toBe("direct");
    expect(sawHandleIr).toBe(handleIr);
  });

  it("returns 503 when there is no proxy and no injected serveDirect", async () => {
    const res = await dispatchOpencodeFetch({ id: "p", handleIr: async () => ({}) as any }, req(), {}, ctx);
    expect(res.status).toBe(503);
    expect((await res.json()).error.type).toBe("loader_error");
  });
});
