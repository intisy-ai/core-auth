import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { notify, setNotifier, notifyQueuePath, setAppClient } from "./notify.js";

let home: string;
let prevEnv: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "core-auth-notify-"));
  prevEnv = process.env.HUB_CONFIG_DIR;
  process.env.HUB_CONFIG_DIR = home;
});

afterEach(() => {
  setNotifier(null);
  if (prevEnv === undefined) delete process.env.HUB_CONFIG_DIR;
  else process.env.HUB_CONFIG_DIR = prevEnv;
  rmSync(home, { recursive: true, force: true });
});

describe("notify", () => {
  it("routes through an injected notifier and does not touch the queue file", () => {
    const seen: Array<{ message: string; level: string }> = [];
    setNotifier((message: string, level: string) => seen.push({ message, level }));
    notify("routed", "warning");
    expect(seen).toEqual([{ message: "routed", level: "warning" }]);
    expect(existsSync(notifyQueuePath(home))).toBe(false);
  });

  it("falls back to the queue file when no notifier is injected", () => {
    notify("queued", "info");
    const lines = readFileSync(notifyQueuePath(home), "utf8").trim().split("\n");
    expect(JSON.parse(lines[0])).toMatchObject({ message: "queued", level: "info" });
  });
});

describe("notification delivery follows the client, not the app", () => {
  beforeEach(() => { vi.resetModules(); });

  it("uses the app client's toast when one is registered", async () => {
    const { notify, setAppClient } = await import("./notify.js");
    const showToast = vi.fn(() => Promise.resolve());
    setAppClient({ tui: { showToast } });
    notify("hello", "success");
    expect(showToast).toHaveBeenCalledWith({ body: { message: "hello", variant: "success" } });
    setAppClient(null);
  });

  it("queues to disk when no client is registered", async () => {
    const { notify, notifyQueuePath, setAppClient } = await import("./notify.js");
    setAppClient(null);
    notify("queued", "info");
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(notifyQueuePath(), "utf8")).toContain("queued");
  });

  it("delivers via registered client regardless of app id", async () => {
    const prevAppId = process.env.HUB_APP_ID;
    process.env.HUB_APP_ID = "claude";
    try {
      vi.resetModules();
      const { notify, setAppClient } = await import("./notify.js");
      const showToast = vi.fn(() => Promise.resolve());
      setAppClient({ tui: { showToast } });
      notify("cross-app", "warning");
      expect(showToast).toHaveBeenCalledWith({ body: { message: "cross-app", variant: "warning" } });
      setAppClient(null);
    } finally {
      if (prevAppId === undefined) delete process.env.HUB_APP_ID;
      else process.env.HUB_APP_ID = prevAppId;
    }
  });
});
