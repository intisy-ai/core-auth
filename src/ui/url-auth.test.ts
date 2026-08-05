// How a login ends is part of the record: a completed login reports ok with the time
// the flow took, every failing path reports failed. Drives the real buildLoginInput
// with a fake driver, so no browser opens (openBrowser ignores an empty url) and
// nothing reaches the network.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildLoginInput } from "./url-auth.js";
import { setActivityEmitter } from "../activity.js";

let seen: any[] = [];
let home: string;
let savedHome: string | undefined;

function fakeDef(overrides: Record<string, unknown> = {}): any {
  return {
    id: "demo-auth",
    label: "Demo",
    loginFlow: async () => ({ url: "", complete: async () => ({ id: "a@b.c", refresh: "r" }) }),
    ...overrides,
  };
}

beforeEach(() => {
  seen = [];
  setActivityEmitter((spec: any) => seen.push(spec));
  home = mkdtempSync(join(tmpdir(), "core-auth-urlauth-"));
  savedHome = process.env.HUB_CONFIG_DIR;
  process.env.HUB_CONFIG_DIR = home;
});

afterEach(() => {
  setActivityEmitter(null);
  if (savedHome === undefined) delete process.env.HUB_CONFIG_DIR;
  else process.env.HUB_CONFIG_DIR = savedHome;
  rmSync(home, { recursive: true, force: true });
});

function specFor(action: string): any {
  return seen.find((spec) => spec.action === action);
}

describe("url login activity", () => {
  it("reports a pasted-code login as ok, with how long the flow took", async () => {
    const { input } = await buildLoginInput(fakeDef());
    await input.complete("pasted-code");

    const ok = specFor("login_succeeded");
    expect(ok.outcome).toBe("ok");
    expect(typeof ok.durationMs).toBe("number");
    expect(ok.durationMs).toBeGreaterThanOrEqual(0);
    expect(specFor("login_failed")).toBeUndefined();
  });

  it("reports a throwing exchange as failed", async () => {
    const def = fakeDef({
      loginFlow: async () => ({ url: "", complete: async () => { throw new Error("bad code"); } }),
    });
    const { input } = await buildLoginInput(def);
    await expect(input.complete("pasted-code")).rejects.toThrow("bad code");

    const failed = specFor("login_failed");
    expect(failed.outcome).toBe("failed");
    expect(failed.details.message).toBe("bad code");
  });

  it("reports an exchange that returns no account as failed", async () => {
    const def = fakeDef({ loginFlow: async () => ({ url: "", complete: async () => null }) });
    const { input } = await buildLoginInput(def);
    await input.complete("pasted-code");

    expect(specFor("login_failed").outcome).toBe("failed");
  });

  it("reports a loopback login as ok and a rejected loopback as failed", async () => {
    const okDef = fakeDef({
      loginFlow: async () => ({ url: "", complete: async () => null, loopback: Promise.resolve({ id: "a@b.c", refresh: "r" }) }),
    });
    const okInput = await buildLoginInput(okDef);
    await okInput.input.background;
    expect(specFor("login_succeeded").outcome).toBe("ok");
    expect(typeof specFor("login_succeeded").durationMs).toBe("number");

    seen = [];
    const failDef = fakeDef({
      loginFlow: async () => ({ url: "", complete: async () => null, loopback: Promise.reject(new Error("listener died")) }),
    });
    const failInput = await buildLoginInput(failDef);
    await failInput.input.background;
    expect(specFor("login_failed").outcome).toBe("failed");
    expect(specFor("login_failed").details.message).toBe("listener died");
  });
});
