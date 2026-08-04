import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createProviderPlugin, dispatchFetch } from "../provider-plugin-runtime.js";
import { __resetFrontDoorCacheForTests } from "../frontdoor.js";

const def: any = { id: "stub", label: "Stub", models: [], handleIr: async () => ({}), loginFlow: undefined };

beforeEach(() => {
  delete process.env.HUB_APP_FRONTDOOR;
  delete process.env.HUB_OC_PROXY;
  __resetFrontDoorCacheForTests();
});

afterEach(() => {
  delete process.env.HUB_CONFIG_DIR;
});

describe("dispatchFetch", () => {
  it("returns 503 when no daemon and no front-door", async () => {
    const home = mkdtempSync(join(tmpdir(), "pp-"));
    const res = await dispatchFetch(def, new Request("http://x/v1/messages"), process.env, { configDir: home, log() {} });
    expect(res.status).toBe(503);
  });

  it("calls the injected front-door's serve when resolvable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-"));
    const p = join(dir, "frontdoor.mjs");
    writeFileSync(p, `export const appFrontDoor = { buildPluginHooks: () => ({}), serve: async () => new Response("ok", { status: 201 }) };`);
    process.env.HUB_APP_FRONTDOOR = p;
    const res = await dispatchFetch(def, new Request("http://x/v1/messages"), process.env, { configDir: dir, log() {} });
    expect(res.status).toBe(201);
  });
});

describe("createProviderPlugin", () => {
  it("delegates hook building to the injected front-door with a toolkit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-"));
    const p = join(dir, "frontdoor.mjs");
    writeFileSync(p, `export const appFrontDoor = { serve: async () => new Response(""), buildPluginHooks: (d, input, tk) => ({ marker: d.id + ":" + (typeof tk.dispatchFetch) }) };`);
    process.env.HUB_APP_FRONTDOOR = p;
    process.env.HUB_CONFIG_DIR = dir;
    const plugin = createProviderPlugin(def);
    const hooks = await plugin({ client: null });
    expect(hooks.marker).toBe("stub:function");
  });
});
