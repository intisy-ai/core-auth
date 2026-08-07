import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFileSync } from "child_process";
import { resolveAppFrontDoor, importModuleFromPath, __resetFrontDoorCacheForTests } from "../frontdoor.js";

function fakeAdapterModule(dir: string): string {
  const p = join(dir, "frontdoor.mjs");
  writeFileSync(p, `export const appFrontDoor = { buildPluginHooks: () => ({ ok: true }), serve: async () => new Response("served") };\n`);
  return p;
}

describe("resolveAppFrontDoor", () => {
  beforeEach(() => { delete process.env.HUB_APP_FRONTDOOR; __resetFrontDoorCacheForTests(); });

  it("returns null when no channel is published", async () => {
    const home = mkdtempSync(join(tmpdir(), "fd-"));
    expect(await resolveAppFrontDoor({ configDir: home })).toBeNull();
  });

  it("resolves the adapter from HUB_APP_FRONTDOOR env-path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fd-"));
    process.env.HUB_APP_FRONTDOOR = fakeAdapterModule(dir);
    const fd = await resolveAppFrontDoor({ configDir: dir });
    expect(fd).not.toBeNull();
    expect((await fd!.serve(new Request("http://x/"), null, null)).status).toBe(200);
  });

  it("falls back to the deployed generic home-path when env is unset", async () => {
    const home = mkdtempSync(join(tmpdir(), "fd-"));
    const dep = join(home, "frontdoor");
    mkdirSync(dep, { recursive: true });
    writeFileSync(join(dep, "app-frontdoor.mjs"), `export const appFrontDoor = { buildPluginHooks: () => ({}), serve: async () => new Response("home") };`);
    const fd = await resolveAppFrontDoor({ configDir: home });
    expect(fd).not.toBeNull();
    expect((await fd!.serve(new Request("http://x/"), null, null)).status).toBe(200);
  });

  it("importModuleFromPath resolves an absolute path adapter", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fd-"));
    const p = fakeAdapterModule(dir);
    const mod = await importModuleFromPath(p);
    expect(typeof mod.appFrontDoor.serve).toBe("function");
  });

  // Vite's dev loader tolerates bare absolute-path specifiers in import(), which can hide a real
  // bug: raw Node ESM reads a Windows drive letter as a URL scheme. This spawns an actual `node`
  // child process, outside Vite/vitest's loader, to prove the file: URL the code uses works there.
  //
  // Whether the BARE path also fails is deliberately not asserted: that is Node's behavior, not
  // ours, and it differs by platform and version (it loads fine on Linux under Node 24, which is
  // what CI runs).
  it("raw Node ESM (spawned child process) can import the adapter the same way resolveAppFrontDoor does", () => {
    const dir = mkdtempSync(join(tmpdir(), "fd-rawnode-"));
    const adapterPath = fakeAdapterModule(dir);

    const runnerPath = join(dir, "runner.mjs");
    writeFileSync(
      runnerPath,
      `
import { pathToFileURL } from "url";

const target = ${JSON.stringify(adapterPath)};

const mod = await import(pathToFileURL(target).href);
if (typeof mod.appFrontDoor?.serve !== "function") throw new Error("adapter did not load via file: URL");

console.log(JSON.stringify({ loaded: true }));
`
    );

    const output = execFileSync(process.execPath, [runnerPath], { encoding: "utf-8" }).trim();
    const result = JSON.parse(output);

    expect(result.loaded).toBe(true);
  });
});
