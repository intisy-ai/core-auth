import { describe, expect, it, vi } from "vitest";
import { PROVIDER_SUPPORT, providerSupport } from "./provider-support.js";

const driver = {
  id: "stub",
  label: "Stub",
  models: { "stub-model": { name: "Stub Default" } },
  handleIr: vi.fn(async () => ({ ok: true })),
};

describe("providerSupport", () => {
  // A provider names this id in services.consumes and mints the key from it, so the id is the
  // contract: renaming it silently leaves every provider asking for a service nobody offers.
  it("is offered under the bare id a provider's manifest consumes", () => {
    expect(PROVIDER_SUPPORT).toBe("provider-support");
  });

  it("builds the provider capability a plugin would otherwise import this library for", async () => {
    const support = providerSupport();

    const capability = support.capability(driver as never);

    expect(capability.id).toBe("stub");
    expect(await capability.providers()).toEqual([
      { id: "stub", label: "Stub", models: { "stub-model": { name: "Stub Default" } }, hasOAuth: false, accountPool: "stub" },
    ]);
  });

  it("writes an account list where a provider's accounts action would", () => {
    const written: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      providerSupport().printAccounts("stub", { list: () => [{ id: "a1", email: "one@example.com" }] } as never);
    } finally {
      write.mockRestore();
    }
    expect(written.join("")).toBe("- one@example.com\n");
  });
});
