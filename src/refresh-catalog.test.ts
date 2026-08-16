import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;
let appHome: string;
const saved: Record<string, string | undefined> = {};
const KEYS = ["HUB_APPS_FILE", "HUB_CONFIG_DIR", "HUB_APP_ID", "CORE_APP", "ZETA_CONFIG"];

function writeRegistry(modelCatalog: unknown): void {
  writeFileSync(join(dir, "apps.json"), JSON.stringify({
    zeta: {
      id: "zeta", label: "Zeta",
      home: { candidates: [appHome] },
      detect: { binary: "zeta", pkg: "zeta-cli" },
      ...(modelCatalog ? { modelCatalog } : {}),
    },
  }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-auth-catalog-"));
  appHome = join(dir, "home");
  mkdirSync(appHome, { recursive: true });
  for (const key of KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  process.env.HUB_APPS_FILE = join(dir, "apps.json");
  process.env.HUB_CONFIG_DIR = appHome;
  process.env.HUB_APP_ID = "zeta";
  vi.resetModules();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("an app that declares no model catalog", () => {
  it("is not merged into", async () => {
    writeRegistry(null);
    const { mergesModelCatalog } = await import("./refresh.js");
    expect(mergesModelCatalog()).toBe(false);
  });

  it("has nothing written even when a merge is asked for", async () => {
    writeRegistry(null);
    const { mergeModels } = await import("./refresh.js");
    mergeModels("zeta-provider", { "model-a": {} });
    expect(existsSync(join(appHome, "zeta.json"))).toBe(false);
  });
});

describe("an app that declares one", () => {
  it("is merged into, under its declared provider key and schema", async () => {
    writeRegistry({ files: ["zeta.json"], schemaUrl: "https://example.invalid/schema", providerKey: "provider" });
    const { mergeModels, mergesModelCatalog } = await import("./refresh.js");
    expect(mergesModelCatalog()).toBe(true);
    mergeModels("zeta-provider", { "model-a": { name: "A" } }, "zeta-sdk");
    const written = JSON.parse(readFileSync(join(appHome, "zeta.json"), "utf8"));
    expect(written.$schema).toBe("https://example.invalid/schema");
    expect(written.provider["zeta-provider"].models).toEqual({ "model-a": { name: "A" } });
    expect(written.provider["zeta-provider"].npm).toBe("zeta-sdk");
    expect(written.provider["zeta-provider"].options.apiKey).toBe("zeta-provider");
  });

  it("replaces the provider's models rather than merging them", async () => {
    writeRegistry({ files: ["zeta.json"], providerKey: "provider" });
    writeFileSync(join(appHome, "zeta.json"), JSON.stringify({ provider: { "zeta-provider": { models: { stale: {} } } } }));
    const { mergeModels } = await import("./refresh.js");
    mergeModels("zeta-provider", { fresh: {} });
    const written = JSON.parse(readFileSync(join(appHome, "zeta.json"), "utf8"));
    expect(Object.keys(written.provider["zeta-provider"].models)).toEqual(["fresh"]);
  });

  it("prefers the first declared file that exists", async () => {
    writeRegistry({ files: ["zeta.jsonc", "zeta.json"], providerKey: "provider" });
    writeFileSync(join(appHome, "zeta.jsonc"), JSON.stringify({ marker: "jsonc" }));
    writeFileSync(join(appHome, "zeta.json"), JSON.stringify({ marker: "json" }));
    const { mergeModels } = await import("./refresh.js");
    mergeModels("zeta-provider", { fresh: {} });
    const written = JSON.parse(readFileSync(join(appHome, "zeta.jsonc"), "utf8"));
    expect(written.provider["zeta-provider"].models).toEqual({ fresh: {} });
    const untouched = JSON.parse(readFileSync(join(appHome, "zeta.json"), "utf8"));
    expect(untouched).toEqual({ marker: "json" });
  });

  it("creates the last declared file when none of them exists yet", async () => {
    writeRegistry({ files: ["zeta.jsonc", "zeta.json"], providerKey: "provider" });
    const { mergeModels } = await import("./refresh.js");
    mergeModels("zeta-provider", { fresh: {} });
    expect(existsSync(join(appHome, "zeta.json"))).toBe(true);
    expect(existsSync(join(appHome, "zeta.jsonc"))).toBe(false);
  });

  it("lets the declared env override name the file outright", async () => {
    const elsewhere = join(dir, "elsewhere.json");
    process.env.ZETA_CONFIG = elsewhere;
    writeRegistry({ files: ["zeta.json"], envOverride: "ZETA_CONFIG", providerKey: "provider" });
    const { mergeModels } = await import("./refresh.js");
    mergeModels("zeta-provider", { fresh: {} });
    expect(existsSync(elsewhere)).toBe(true);
  });
});

// The provider plugin's startup refresh runs inside the app's own process, where no home is
// injected. The declaration alone has to carry it: the target comes from the descriptor's own
// candidates, and an app declaring no catalog gets nothing written.
describe("the startup refresh, with no home injected", () => {
  const def = { id: "demo-auth", label: "Demo", models: { "demo-model": { name: "Demo Model" } } } as any;

  it("merges into the file the descriptor declares", async () => {
    delete process.env.HUB_CONFIG_DIR;
    writeRegistry({ files: ["zeta.json"], providerKey: "provider" });
    const { refreshModels } = await import("./refresh.js");
    await refreshModels(def);
    const written = JSON.parse(readFileSync(join(appHome, "zeta.json"), "utf8"));
    expect(written.provider["demo-auth"].models).toEqual({ "demo-model": { name: "Demo Model" } });
  });

  it("writes no catalog for an app that declares none", async () => {
    delete process.env.HUB_CONFIG_DIR;
    writeRegistry(null);
    const { refreshModels } = await import("./refresh.js");
    await refreshModels(def);
    expect(existsSync(join(appHome, "zeta.json"))).toBe(false);
  });
});
