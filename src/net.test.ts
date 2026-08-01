import { describe, it, expect, vi } from "vitest";
import { proxiedFetch, timeoutFetch } from "./net.js";

function fakeProxyManager(url) {
  return {
    selectForAccount: vi.fn(() => url),
    reportResult: vi.fn(),
  };
}

describe("proxiedFetch", () => {
  it("applies the selected proxy and reports success with elapsed ms", async () => {
    const response = new Response("ok");
    const fetchImpl = vi.fn(async () => response);
    const proxyManager = fakeProxyManager("http://proxy");

    const result = await proxiedFetch("https://api.example.com", { method: "GET" }, {
      accountId: "a1", providerId: "p", proxyManager, fetchImpl,
    });

    expect(proxyManager.selectForAccount).toHaveBeenCalledWith("a1", "p");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].proxy).toBe("http://proxy");
    expect(proxyManager.reportResult).toHaveBeenCalledWith("http://proxy", true, expect.any(Number));
    expect(result.proxyUsed).toBe(true);
    expect(result.transportFailed).toBe(false);
    expect(result.response).toBe(response);
  });

  it("on a proxy fetch throw, reports failure and retries the same request directly", async () => {
    const response = new Response("direct-ok");
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("proxy down"))
      .mockResolvedValueOnce(response);
    const proxyManager = fakeProxyManager("http://proxy");
    const log = vi.fn();

    const result = await proxiedFetch("https://api.example.com", { method: "GET" }, {
      accountId: "a1", providerId: "p", proxyManager, fetchImpl, log,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][1].proxy).toBe("http://proxy");
    expect(fetchImpl.mock.calls[1][1].proxy).toBeUndefined();
    expect(proxyManager.reportResult).toHaveBeenCalledWith("http://proxy", false);
    expect(proxyManager.reportResult).not.toHaveBeenCalledWith("http://proxy", true, expect.anything());
    expect(result.transportFailed).toBe(false);
    expect(result.proxyUsed).toBe(true);
    expect(result.response).toBe(response);
    expect(log).toHaveBeenCalled();
  });

  it("returns transportFailed when the direct retry after a proxy throw also fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down"));
    const proxyManager = fakeProxyManager("http://proxy");

    const result = await proxiedFetch("https://api.example.com", { method: "GET" }, {
      accountId: "a1", providerId: "p", proxyManager, fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.transportFailed).toBe(true);
    expect(result.proxyUsed).toBe(true);
    expect(result.response).toBeUndefined();
  });

  it("returns transportFailed with no proxy applied when there is no proxy and the direct fetch throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("down"));
    const proxyManager = { selectForAccount: vi.fn(() => null), reportResult: vi.fn() };

    const result = await proxiedFetch("https://api.example.com", { method: "GET" }, {
      accountId: "a1", providerId: "p", proxyManager, fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.transportFailed).toBe(true);
    expect(result.proxyUsed).toBe(false);
    expect(proxyManager.reportResult).not.toHaveBeenCalled();
  });

  it("works with no proxyManager at all (plain direct fetch)", async () => {
    const response = new Response("ok");
    const fetchImpl = vi.fn(async () => response);

    const result = await proxiedFetch("https://api.example.com", { method: "GET" }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.proxyUsed).toBe(false);
    expect(result.transportFailed).toBe(false);
    expect(result.response).toBe(response);
  });
});

describe("timeoutFetch", () => {
  it("aborts a fetch that never resolves once timeoutMs elapses", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));

    const started = Date.now();
    await expect(timeoutFetch("https://api.example.com", {}, 30, fetchImpl)).rejects.toThrow(/aborted/i);
    expect(Date.now() - started).toBeLessThan(300);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns the response and clears the timer when fetch resolves before timeoutMs", async () => {
    const response = new Response("ok");
    const fetchImpl = vi.fn(async () => response);
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const result = await timeoutFetch("https://api.example.com", { method: "GET" }, 20000, fetchImpl);

    expect(result).toBe(response);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it("passes an abort signal through to fetchImpl alongside the caller's init", async () => {
    const response = new Response("ok");
    const fetchImpl = vi.fn(async () => response);

    await timeoutFetch("https://api.example.com", { method: "POST" }, 20000, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
