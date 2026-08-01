import { describe, it, expect, vi, afterEach } from "vitest";
import { accountControllerFromManager, refreshAccountToken, verifyAllAccounts } from "./controller.js";

function fakeManager(accounts) {
  return {
    list: () => accounts,
    mutate: (id, fn) => { const a = accounts.find((x) => x.id === id); if (a) fn(a); },
    remove: vi.fn(),
    refresh: vi.fn(),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("accountControllerFromManager", () => {
  it("falls back to defaultStatus's disabled/cooling-down/rate-limited/active ladder when no status override is given", () => {
    const now = 1000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const accounts = [
      { id: "a", enabled: false },
      { id: "b", enabled: true, coolingDownUntil: now + 1 },
      { id: "c", enabled: true, rateLimitResetTimes: { lane1: now + 1 } },
      { id: "d", enabled: true },
    ];
    const controller = accountControllerFromManager(fakeManager(accounts), {});
    const statuses = controller.list().map((v) => v.status);
    expect(statuses).toEqual(["disabled", "cooling-down", "rate-limited", "active"]);
  });
});

describe("refreshAccountToken", () => {
  it("reports success when manager.refresh resolves true", async () => {
    const manager = fakeManager([]);
    manager.refresh.mockResolvedValue(true);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await refreshAccountToken(manager, { id: "acc1", email: "a@x.com" });
    expect(manager.refresh).toHaveBeenCalledWith("acc1");
    expect(write).toHaveBeenCalledWith(expect.stringContaining("refreshed a@x.com"));
  });

  it("reports failure when manager.refresh resolves false", async () => {
    const manager = fakeManager([]);
    manager.refresh.mockResolvedValue(false);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await refreshAccountToken(manager, { id: "acc1" });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("no OAuth config / refresh token for acc1"));
  });

  it("reports the error message when manager.refresh throws", async () => {
    const manager = fakeManager([]);
    manager.refresh.mockRejectedValue(new Error("boom"));
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await refreshAccountToken(manager, { id: "acc1" });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("refresh failed for acc1: boom"));
  });
});

describe("verifyAllAccounts", () => {
  it("skips disabled accounts and calls the injected verify for enabled ones, then prints Done", async () => {
    const accounts = [
      { id: "a", email: "a@x.com", enabled: false },
      { id: "b", email: "b@x.com", enabled: true },
    ];
    const manager = fakeManager(accounts);
    const verify = vi.fn().mockResolvedValue(undefined);
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await verifyAllAccounts(manager, verify);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledWith(manager, { id: "b", email: "b@x.com" });
    expect(write).toHaveBeenCalledWith(expect.stringContaining("skipped (disabled)"));
    expect(write).toHaveBeenCalledWith(expect.stringContaining("Done."));
  });
});
