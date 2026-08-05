// A model refresh is a network round trip a user waits on, so the record says how it
// ended and how long it took. Driven with a driver whose catalog is supplied inline,
// so nothing reaches the network.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { refreshModels } from "./refresh.js";
import { setActivityEmitter } from "./activity.js";

let seen: any[] = [];
let home: string;
let savedHome: string | undefined;

beforeEach(() => {
  seen = [];
  setActivityEmitter((spec: any) => seen.push(spec));
  home = mkdtempSync(join(tmpdir(), "core-auth-refresh-"));
  savedHome = process.env.HUB_CONFIG_DIR;
  process.env.HUB_CONFIG_DIR = home;
});

afterEach(() => {
  setActivityEmitter(null);
  if (savedHome === undefined) delete process.env.HUB_CONFIG_DIR;
  else process.env.HUB_CONFIG_DIR = savedHome;
  rmSync(home, { recursive: true, force: true });
});

describe("model refresh activity", () => {
  it("records a completed refresh as ok, with its duration and model count", async () => {
    const def: any = {
      id: "demo-auth",
      label: "Demo",
      models: { "demo-model": { name: "Demo Model" } },
    };

    await refreshModels(def);

    const rec = seen.find((spec) => spec.action === "models_refreshed");
    expect(rec).toBeDefined();
    expect(rec.outcome).toBe("ok");
    expect(typeof rec.durationMs).toBe("number");
    expect(rec.durationMs).toBeGreaterThanOrEqual(0);
    expect(rec.details.count).toBe(1);
  });
});
