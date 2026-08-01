import { expect, it } from "vitest";
import { initCoreAuth, getCoreAuth } from "../core-auth-loader.js";

it("getCoreAuth throws before initCoreAuth has run", () => {
  // This test file must not have called initCoreAuth yet: it runs standalone (no shared
  // beforeAll), so the module-level state is fresh.
  expect(() => getCoreAuth()).toThrow(/not initialized/);
});

it("initCoreAuth resolves the generated module once and getCoreAuth reads it back synchronously", async () => {
  await initCoreAuth();
  const a = getCoreAuth();
  await initCoreAuth();
  const b = getCoreAuth();
  expect(a).toBe(b);
  expect(typeof (a as Record<string, unknown>).calculateBackoffMsJson).toBe("function");
});
