import { describe, it, expect, vi, beforeEach } from "vitest";

const { createOpencodePluginMock } = vi.hoisted(() => ({ createOpencodePluginMock: vi.fn() }));
vi.mock("./opencode.js", () => ({ createOpencodePlugin: createOpencodePluginMock }));

import { defineProviderPlugin, type ProviderPluginCore } from "./provider-plugin.js";

function makeCore(order: string[]): ProviderPluginCore {
  return {
    defineConfig: vi.fn((name, defaults) => { order.push("defineConfig"); return defaults; }),
    defineCapabilities: vi.fn(() => { order.push("defineCapabilities"); }),
    defineReadme: vi.fn((spec) => { order.push("defineReadme"); return spec; }),
    maybeRunReadmeCli: vi.fn(() => { order.push("maybeRunReadmeCli"); return false; }),
    deployCommands: vi.fn(() => { order.push("deployCommands"); return []; }),
  };
}

const driver = { id: "stub", label: "Stub", models: {} } as never;

describe("defineProviderPlugin", () => {
  beforeEach(() => {
    createOpencodePluginMock.mockReset();
  });

  it("registers config, capabilities, readme and deploys commands in order before returning the opencode plugin", async () => {
    const order: string[] = [];
    const core = makeCore(order);
    const configCliGuard = vi.fn(() => { order.push("configCliGuard"); return false; });
    const sentinel = { hooks: true };
    createOpencodePluginMock.mockReturnValue(sentinel);

    const result = await defineProviderPlugin({
      name: "stub-auth",
      driver,
      core,
      configCliGuard,
      defaults: { logging: true },
      capabilities: { fields: [{ key: "logging", type: "boolean" }] },
      readme: { description: "stub" },
      commands: [{ name: "stub-auth-config", description: "config" }],
    });

    expect(order).toEqual([
      "defineConfig",
      "defineCapabilities",
      "defineReadme",
      "maybeRunReadmeCli",
      "configCliGuard",
      "deployCommands",
    ]);
    expect(core.defineConfig).toHaveBeenCalledWith("stub-auth", { logging: true });
    expect(core.deployCommands).toHaveBeenCalledWith("stub-auth", [{ name: "stub-auth-config", description: "config" }]);
    expect(createOpencodePluginMock).toHaveBeenCalledWith(driver);
    expect(result).toBe(sentinel);
  });

  it("registers config before the config-CLI guard even when the guard short-circuits", async () => {
    const order: string[] = [];
    const core = makeCore(order);
    const exit = vi.fn();
    const configCliGuard = vi.fn(() => { order.push("configCliGuard"); return true; });

    const result = await defineProviderPlugin({
      name: "custom-auth",
      driver,
      core,
      configCliGuard,
      defaults: { endpoints: [] },
      exit,
    });

    expect(order).toEqual(["defineConfig", "configCliGuard"]);
    expect(exit).toHaveBeenCalledWith(0);
    expect(core.deployCommands).not.toHaveBeenCalled();
    expect(createOpencodePluginMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("short-circuits on the readme guard before the config-CLI guard ever runs", async () => {
    const order: string[] = [];
    const core = makeCore(order);
    core.maybeRunReadmeCli = vi.fn(() => { order.push("maybeRunReadmeCli"); return true; });
    const exit = vi.fn();
    const configCliGuard = vi.fn(() => { order.push("configCliGuard"); return false; });

    const result = await defineProviderPlugin({
      name: "antigravity",
      driver,
      core,
      configCliGuard,
      readme: { description: "antigravity" },
      exit,
    });

    expect(order).toEqual(["defineConfig", "defineReadme", "maybeRunReadmeCli"]);
    expect(exit).toHaveBeenCalledWith(0);
    expect(configCliGuard).not.toHaveBeenCalled();
    expect(createOpencodePluginMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("supports an async config-CLI guard (a provider's own maybeRunCli)", async () => {
    const order: string[] = [];
    const core = makeCore(order);
    const exit = vi.fn();
    const configCliGuard = vi.fn(async () => { order.push("configCliGuard"); return true; });

    await defineProviderPlugin({ name: "claude-code", driver, core, configCliGuard, exit });

    expect(exit).toHaveBeenCalledWith(0);
    expect(createOpencodePluginMock).not.toHaveBeenCalled();
  });

  it("skips capabilities, readme and deployCommands when not provided, and never crashes on a deployCommands failure", async () => {
    const order: string[] = [];
    const core = makeCore(order);
    core.deployCommands = vi.fn(() => { throw new Error("no configDirs"); });
    const configCliGuard = vi.fn(() => false);
    createOpencodePluginMock.mockReturnValue({});

    await defineProviderPlugin({
      name: "custom-auth",
      driver,
      core,
      configCliGuard,
      commands: [{ name: "custom-auth-config", description: "config" }],
    });

    expect(core.defineCapabilities).not.toHaveBeenCalled();
    expect(core.defineReadme).not.toHaveBeenCalled();
    expect(core.maybeRunReadmeCli).not.toHaveBeenCalled();
    expect(createOpencodePluginMock).toHaveBeenCalled();
  });

  it("falls back deployCommands' bundle name to `name` when packageName is omitted", async () => {
    const order: string[] = [];
    const core = makeCore(order);
    createOpencodePluginMock.mockReturnValue({});

    await defineProviderPlugin({
      name: "stub-auth",
      driver,
      core,
      configCliGuard: () => false,
      commands: [{ name: "stub-auth-config", description: "config" }],
    });

    expect(core.deployCommands).toHaveBeenCalledWith("stub-auth", [{ name: "stub-auth-config", description: "config" }]);
  });
});
