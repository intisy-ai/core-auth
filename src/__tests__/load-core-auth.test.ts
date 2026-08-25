import { expect, it } from "vitest";
import { getCoreAuth, initCoreAuth } from "../core-auth-loader.js";

// The generated module is imported with its importer, so this file deliberately calls getCoreAuth()
// with no init first: the account store's reads are synchronous entry points and a host that
// forgot an init step is the defect this shape removes.
it("getCoreAuth resolves the generated module without any init call", () => {
  expect(typeof getCoreAuth().acquireAccount).toBe("function");
});

it("initCoreAuth stays awaitable for the callers that sequence it", async () => {
  await initCoreAuth();
  expect(typeof getCoreAuth().poolLoad).toBe("function");
});
