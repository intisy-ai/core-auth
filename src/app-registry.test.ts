import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
const saved: Record<string, string | undefined> = {};

const KEYS = ["HUB_APPS_FILE", "HUB_CONFIG_DIR", "CORE_APP", "HUB_APP_ID", "ZETA_CONFIG_DIR"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-auth-registry-"));
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  mkdirSync(join(dir, "homes", "zeta"), { recursive: true });
  writeFileSync(join(dir, "apps.json"), JSON.stringify({
    zeta: {
      id: "zeta", label: "Zeta",
      home: { envOverride: "HUB_ZETA_DIR", nativeEnv: "ZETA_CONFIG_DIR", candidates: [join(dir, "homes", "zeta")] },
      detect: { binary: "zeta", pkg: "zeta-cli" },
      modelCatalog: { files: ["zeta.json"], providerKey: "provider" },
    },
  }));
  process.env.HUB_APPS_FILE = join(dir, "apps.json");
  vi.resetModules();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("the active app id", () => {
  it("is the injected id when one is injected", async () => {
    process.env.HUB_APP_ID = "zeta";
    const { activeAppId } = await import("./env.js");
    expect(activeAppId()).toBe("zeta");
  });

  it("is empty when nothing injected it and nothing detects it", async () => {
    const { activeAppId } = await import("./env.js");
    expect(activeAppId()).toBe("");
  });

  it("comes from the descriptor's own native env var when nothing is injected", async () => {
    process.env.ZETA_CONFIG_DIR = join(dir, "homes", "zeta");
    const { activeAppId } = await import("./env.js");
    expect(activeAppId()).toBe("zeta");
  });
});

describe("the config dir", () => {
  it("prefers the forced dir over everything", async () => {
    process.env.HUB_CONFIG_DIR = join(dir, "forced");
    process.env.HUB_APP_ID = "zeta";
    const { getConfigDir } = await import("./env.js");
    expect(getConfigDir()).toBe(join(dir, "forced"));
  });

  it("resolves the active app's declared home when nothing is forced", async () => {
    process.env.HUB_APP_ID = "zeta";
    const { getConfigDir } = await import("./env.js");
    expect(getConfigDir()).toBe(join(dir, "homes", "zeta"));
  });

  it("is empty for an unknown app rather than guessing one", async () => {
    process.env.HUB_APP_ID = "nobody";
    const { getConfigDir } = await import("./env.js");
    expect(getConfigDir()).toBe("");
  });
});

describe("the active descriptor", () => {
  it("carries the app's declared traits", async () => {
    process.env.HUB_APP_ID = "zeta";
    const { activeDescriptor } = await import("./app-registry.js");
    expect(activeDescriptor()?.modelCatalog?.providerKey).toBe("provider");
  });
});

describe("paths derived from the config dir", () => {
  it("are empty for an unknown app rather than resolving against the cwd", async () => {
    process.env.HUB_APP_ID = "nobody";
    const { configFolder, reposDir, cacheDir } = await import("./env.js");
    expect(configFolder()).toBe("");
    expect(reposDir()).toBe("");
    expect(cacheDir()).toBe("");
  });

  it("still resolve under the app's home for a known app", async () => {
    process.env.HUB_APP_ID = "zeta";
    const { configFolder, reposDir, cacheDir } = await import("./env.js");
    const home = join(dir, "homes", "zeta");
    expect(configFolder()).toBe(join(home, "config"));
    expect(reposDir()).toBe(join(home, "repos"));
    expect(cacheDir()).toBe(join(home, "cache"));
  });
});
