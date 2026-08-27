import { describe, expect, it } from "vitest";
import { AccountManager } from "./manager.js";

describe("AccountManager options", () => {
  it("defaults the selection strategy when none is given", () => {
    const manager = new AccountManager("demo", {});
    expect(manager.strategy).toBe("hybrid");
  });

  it("keeps a store location override", () => {
    const manager = new AccountManager("demo", { store: { dir: "/tmp/demo" } });
    expect(manager.store).toEqual({ dir: "/tmp/demo" });
  });

  it("ignores a non-callable availability hook", () => {
    const manager = new AccountManager("demo", { isAvailable: "nope" as never });
    expect(manager.extraAvailable).toBeNull();
  });
});
