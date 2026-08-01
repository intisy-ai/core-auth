// Frozen-fixture behavior tests for selectIndex: given this pool + strategy + cursor +
// availability, this account is picked. These assert real selection BEHAVIOR (not "matches
// the deleted TS"), so they stay meaningful regardless of whether selectIndex is a pure TS
// function or delegates to CoreAuthJs.acquireAccount under the hood. Pool objects are plain
// in-memory literals; selectIndex never touches disk, so no temp store is needed here.
import { describe, expect, it } from "vitest";
import { selectIndex } from "./selection.js";

const NOW = 1_700_000_000_000;

function account(id: string, overrides: Record<string, unknown> = {}) {
  return { id, enabled: true, ...overrides };
}

function pool(accounts: ReturnType<typeof account>[], activeIndex = 0, activeIndexByLane: Record<string, number> = {}) {
  return { accounts, activeIndex, activeIndexByLane };
}

describe("selectIndex: sticky", () => {
  it("keeps the cursor while it stays available", () => {
    const p = pool([account("a"), account("b"), account("c")], 1);
    expect(selectIndex(p, undefined, NOW, "sticky", undefined)).toBe(1);
  });

  it("moves off the cursor once it becomes unavailable, and does not wrap past strategy semantics", () => {
    const p = pool([account("a"), account("b", { enabled: false }), account("c")], 1);
    expect(selectIndex(p, undefined, NOW, "sticky", undefined)).toBe(2);
  });

  it("returns -1 when every account is unavailable", () => {
    const p = pool([account("a", { enabled: false }), account("b", { enabled: false })], 0);
    expect(selectIndex(p, undefined, NOW, "sticky", undefined)).toBe(-1);
  });
});

describe("selectIndex: round-robin", () => {
  it("advances past the cursor on every call, wrapping around the pool", () => {
    const p = pool([account("a"), account("b"), account("c")], 0);
    expect(selectIndex(p, undefined, NOW, "round-robin", undefined)).toBe(1);
    expect(selectIndex(p, undefined, NOW, "round-robin", undefined)).toBe(2);
    expect(selectIndex(p, undefined, NOW, "round-robin", undefined)).toBe(0);
  });

  it("skips a disabled account while advancing", () => {
    const p = pool([account("a"), account("b", { enabled: false }), account("c")], 0);
    expect(selectIndex(p, undefined, NOW, "round-robin", undefined)).toBe(2);
  });
});

describe("selectIndex: hybrid", () => {
  it("prefers the sticky cursor, like sticky, when it is available", () => {
    const p = pool([account("a"), account("b"), account("c")], 2);
    expect(selectIndex(p, undefined, NOW, "hybrid", undefined)).toBe(2);
  });

  it("falls back to the soonest-free account as a last resort when nobody is currently available", () => {
    const p = pool(
      [
        account("a", { coolingDownUntil: NOW + 5000 }),
        account("b", { coolingDownUntil: NOW + 1000 }),
        account("c", { coolingDownUntil: NOW + 9000 }),
      ],
      0,
    );
    expect(selectIndex(p, undefined, NOW, "hybrid", undefined)).toBe(1);
  });
});

describe("selectIndex: per-lane cursor", () => {
  it("tracks a separate cursor per lane instead of the pool's default activeIndex", () => {
    const p = pool([account("a"), account("b"), account("c")], 0, { fast: 2 });
    expect(selectIndex(p, "fast", NOW, "sticky", undefined)).toBe(2);
    expect(selectIndex(p, "slow", NOW, "sticky", undefined)).toBe(0);
  });

  it("writes the advanced round-robin index back onto the lane's own cursor, not the default", () => {
    const p = pool([account("a"), account("b"), account("c")], 0, { fast: 0 });
    selectIndex(p, "fast", NOW, "round-robin", undefined);
    expect(p.activeIndexByLane.fast).toBe(1);
    expect(p.activeIndex).toBe(0);
  });
});

describe("selectIndex: caller-supplied availability predicate (the isAvailable extension seam)", () => {
  it("skips an account the predicate rejects even though the built-in availability check would accept it", () => {
    const p = pool([account("a"), account("b"), account("c")], 0);
    const skipB = (a: { id: string }) => a.id !== "b";
    expect(selectIndex(p, undefined, NOW, "round-robin", skipB)).toBe(2);
  });

  it("returns -1 for sticky/round-robin when the predicate rejects every account", () => {
    const p = pool([account("a"), account("b")], 0);
    const rejectAll = () => false;
    expect(selectIndex(p, undefined, NOW, "round-robin", rejectAll)).toBe(-1);
  });
});
