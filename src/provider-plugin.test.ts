import { describe, it, expect, vi, beforeEach } from "vitest";

const { createProviderPluginMock, defineReadmeMock, maybeRunReadmeCliMock, order } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    createProviderPluginMock: vi.fn(),
    defineReadmeMock: vi.fn((spec: unknown) => { order.push("defineReadme"); return spec; }),
    maybeRunReadmeCliMock: vi.fn(() => { order.push("maybeRunReadmeCli"); return false; }),
  };
});
vi.mock("./provider-plugin-runtime.js", () => ({ createProviderPlugin: createProviderPluginMock }));
// The prologue's ORDER is what these pin, and core's readme helpers are now called directly rather
// than handed in, so intercepting the module is the only place left to observe it from.
vi.mock("@intisy-ai/core", () => ({ defineReadme: defineReadmeMock, maybeRunReadmeCli: maybeRunReadmeCliMock }));

import { defineProviderPlugin } from "./provider-plugin.js";

const driver = { id: "stub", label: "Stub", models: {} } as never;

describe("defineProviderPlugin", () => {
  beforeEach(() => {
    createProviderPluginMock.mockReset();
    defineReadmeMock.mockClear();
    maybeRunReadmeCliMock.mockClear();
    maybeRunReadmeCliMock.mockImplementation(() => { order.push("maybeRunReadmeCli"); return false; });
    order.length = 0;
  });

  it("registers the readme and clears both guards before returning the provider plugin", async () => {
    const cliGuard = vi.fn(() => { order.push("cliGuard"); return false; });
    const sentinel = { hooks: true };
    createProviderPluginMock.mockReturnValue(sentinel);

    const result = await defineProviderPlugin({
      name: "stub-auth",
      driver,
      cliGuard,
      readme: { description: "stub" },
    });

    expect(order).toEqual(["defineReadme", "maybeRunReadmeCli", "cliGuard"]);
    expect(createProviderPluginMock).toHaveBeenCalledWith(driver);
    expect(result).toBe(sentinel);
  });

  it("exits without booting the provider when the action guard takes the invocation", async () => {
    const exit = vi.fn();
    const cliGuard = vi.fn(() => { order.push("cliGuard"); return true; });

    const result = await defineProviderPlugin({ name: "custom-auth", driver, cliGuard, exit });

    expect(order).toEqual(["cliGuard"]);
    expect(exit).toHaveBeenCalledWith(0);
    expect(createProviderPluginMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("short-circuits on the readme guard before the action guard ever runs", async () => {
    maybeRunReadmeCliMock.mockImplementation(() => { order.push("maybeRunReadmeCli"); return true; });
    const exit = vi.fn();
    const cliGuard = vi.fn(() => { order.push("cliGuard"); return false; });

    const result = await defineProviderPlugin({
      name: "antigravity",
      driver,
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
    const exit = vi.fn();
    const cliGuard = vi.fn(async () => { order.push("cliGuard"); return true; });

    await defineProviderPlugin({ name: "claude-code", driver, cliGuard, exit });

    expect(exit).toHaveBeenCalledWith(0);
    expect(createProviderPluginMock).not.toHaveBeenCalled();
  });

  it("skips the readme entirely when none is supplied", async () => {
    createProviderPluginMock.mockReturnValue({});

    await defineProviderPlugin({ name: "custom-auth", driver, cliGuard: () => false });

    expect(defineReadmeMock).not.toHaveBeenCalled();
    expect(maybeRunReadmeCliMock).not.toHaveBeenCalled();
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
