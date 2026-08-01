import { describe, it, expect } from "vitest";
import { lazyModule, safeJsonParse } from "./lazy.js";

describe("lazyModule", () => {
  it("calls the importer exactly once across multiple load() calls", async () => {
    let calls = 0;
    const mod = lazyModule(async () => {
      calls++;
      return { value: 42 };
    });

    expect(mod.getLoaded()).toBeNull();

    const [a, b] = await Promise.all([mod.load(), mod.load()]);
    expect(a).toEqual({ value: 42 });
    expect(b).toEqual({ value: 42 });
    await mod.load();

    expect(calls).toBe(1);
    expect(mod.getLoaded()).toEqual({ value: 42 });
  });

  it("getLoaded is null before load() resolves and the module after", async () => {
    const mod = lazyModule(async () => "resolved");
    expect(mod.getLoaded()).toBeNull();
    const p = mod.load();
    expect(mod.getLoaded()).toBeNull();
    await p;
    expect(mod.getLoaded()).toBe("resolved");
  });
});

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    expect(safeJsonParse('{"a":1}', null)).toEqual({ a: 1 });
  });

  it("returns the fallback on invalid JSON", () => {
    expect(safeJsonParse("nope", { x: 1 })).toEqual({ x: 1 });
  });

  it("returns the fallback on empty or non-string input", () => {
    expect(safeJsonParse("", { x: 1 })).toEqual({ x: 1 });
    expect(safeJsonParse(undefined as unknown as string, { x: 1 })).toEqual({ x: 1 });
  });
});
