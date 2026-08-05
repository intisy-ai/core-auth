import { describe, it, expect, beforeEach } from "vitest";
import { setActivityEmitter, emitActivity } from "./activity.js";

describe("core-auth activity seam", () => {
  beforeEach(() => setActivityEmitter(null));

  it("is a no-op until an emitter is injected", () => {
    expect(() => emitActivity({ topic: "account", action: "account_added" }, "stub-auth")).not.toThrow();
  });

  it("forwards to the injected emitter", () => {
    const seen: any[] = [];
    setActivityEmitter((spec, source) => seen.push({ spec, source }));
    emitActivity({ topic: "account", action: "account_added", subject: { kind: "account", id: "a@b.c" } }, "stub-auth");
    expect(seen).toHaveLength(1);
    expect(seen[0].spec.action).toBe("account_added");
    expect(seen[0].source).toBe("stub-auth");
  });
});
