import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { notify, setNotifier, notifyQueuePath } from "./notify.js";

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
