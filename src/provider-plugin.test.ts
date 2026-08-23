import { describe, it, expect, vi, beforeEach } from "vitest";

const { createProviderPluginMock } = vi.hoisted(() => ({ createProviderPluginMock: vi.fn() }));
vi.mock("./provider-plugin-runtime.js", () => ({ createProviderPlugin: createProviderPluginMock }));

import { defineProviderPlugin, type ProviderPluginCore } from "./provider-plugin.js";

function makeCore(order: string[]): ProviderPluginCore {
  return {
    defineReadme: vi.fn((spec) => { order.push("defineReadme"); return spec; }),
    maybeRunReadmeCli: vi.fn(() => { order.push("maybeRunReadmeCli"); return false; }),
  };
}

const driver = { id: "stub", label: "Stub", models: {} } as never;

describe("defineProviderPlugin", () => {
  beforeEach(() => {
    createProviderPluginMock.mockReset();
  });

  it("registers the readme and clears both guards before returning the provider plugin", async () => {
    const order: string[] = [];
    const core = makeCore(order);
    const cliGuard = vi.fn(() => { order.push("cliGuard"); return false; });
    const sentinel = { hooks: true };
    createProviderPluginMock.mockReturnValue(sentinel);

    const result = await defineProviderPlugin({
      name: "stub-auth",
      driver,
      core,
      cliGuard,
      readme: { description: "stub" },
    });

    expect(order).toEqual(["defineReadme", "maybeRunReadmeCli", "cliGuard"]);
    expect(createProviderPluginMock).toHaveBeenCalledWith(driver);
    expect(result).toBe(sentinel);
  });

  it("exits without booting the provider when the action guard takes the invocation", async () => {
    const order: string[] = [];
    const core = makeCore(order);
    const exit = vi.fn();
    const cliGuard = vi.fn(() => { order.push("cliGuard"); return true; });

    const result = await defineProviderPlugin({ name: "custom-auth", driver, core, cliGuard, exit });

    expect(order).toEqual(["cliGuard"]);
    expect(exit).toHaveBeenCalledWith(0);
    expect(createProviderPluginMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("short-circuits on the readme guard before the action guard ever runs", async () => {
    const order: string[] = [];
    const core = makeCore(order);
    core.maybeRunReadmeCli = vi.fn(() => { order.push("maybeRunReadmeCli"); return true; });
    const exit = vi.fn();
    const cliGuard = vi.fn(() => { order.push("cliGuard"); return false; });

    const result = await defineProviderPlugin({
      name: "antigravity",
      driver,
      core,
      cliGuard,
      readme: { description: "antigravity" },
      exit,
    });

    expect(order).toEqual(["defineReadme", "maybeRunReadmeCli"]);
    expect(exit).toHaveBeenCalledWith(0);
    expect(cliGuard).not.toHaveBeenCalled();
    expect(createProviderPluginMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("supports an async action guard (a provider's own maybeRunCli)", async () => {
    const order: string[] = [];
    const core = makeCore(order);
    const exit = vi.fn();
    const cliGuard = vi.fn(async () => { order.push("cliGuard"); return true; });

    await defineProviderPlugin({ name: "claude-code", driver, core, cliGuard, exit });

    expect(exit).toHaveBeenCalledWith(0);
    expect(createProviderPluginMock).not.toHaveBeenCalled();
  });

  it("skips the readme entirely when none is supplied", async () => {
    const order: string[] = [];
    const core = makeCore(order);
    createProviderPluginMock.mockReturnValue({});

    await defineProviderPlugin({ name: "custom-auth", driver, core, cliGuard: () => false });

    expect(core.defineReadme).not.toHaveBeenCalled();
    expect(core.maybeRunReadmeCli).not.toHaveBeenCalled();
    expect(createProviderPluginMock).toHaveBeenCalled();
  });
});

describe("defineProviderPlugin with neither a readme nor an action guard", () => {
  it("boots the provider directly, since a provider that declares everything has nothing to run first", async () => {
    createProviderPluginMock.mockReturnValue({ hooks: true });
    const result = await defineProviderPlugin({ name: "custom-auth", driver });
    expect(createProviderPluginMock).toHaveBeenCalledWith(driver);
    expect(result).toEqual({ hooks: true });
  });
});
