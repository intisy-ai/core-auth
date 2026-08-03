import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveAppFrontDoor, __resetFrontDoorCacheForTests } from "../frontdoor.js";

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

  it("falls back to the deployed home-path when env is unset", async () => {
    const home = mkdtempSync(join(tmpdir(), "fd-"));
    const dep = join(home, "repos", "opencode-loader", "dist");
    mkdirSync(dep, { recursive: true });
    writeFileSync(join(dep, "frontdoor.mjs"), `export const appFrontDoor = { buildPluginHooks: () => ({}), serve: async () => new Response("home") };`);
    const fd = await resolveAppFrontDoor({ configDir: home });
    expect(fd).not.toBeNull();
  });
});
