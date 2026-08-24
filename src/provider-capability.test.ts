import { describe, expect, it, vi } from "vitest";
import { descriptorFor, providerCapability } from "./provider-capability.js";
import type { ProviderDef } from "./types.js";

const driver = {
  id: "stub",
  label: "Stub",
  models: { "stub-model": { name: "Stub Default" } },
  handleIr: vi.fn(async () => ({ ok: true })),
  loginFlow: async () => ({ url: "", complete: async () => null }),
};

describe("descriptorFor", () => {
  it("describes a driver as one lane, defaulting the pool to its own id", () => {
    expect(descriptorFor(driver as never)).toEqual({
      id: "stub",
      label: "Stub",
      models: { "stub-model": { name: "Stub Default" } },
      hasOAuth: true,
      accountPool: "stub",
    });
  });

  it("reports no OAuth for a driver with no login flow", () => {
    expect(descriptorFor({ id: "k", label: "K", models: {} } as never).hasOAuth).toBe(false);
  });
});

describe("providerCapability", () => {
  it("carries the driver's id and delegates handleIr to it", async () => {
    const capability = providerCapability(driver as never);
    expect(capability.id).toBe("stub");
    await capability.handleIr({ model: "stub-model" } as never, { provider: "stub" } as never);
    expect(driver.handleIr).toHaveBeenCalledWith({ model: "stub-model" }, { provider: "stub" });
  });

  it("advertises only the driver's own lane when no extra lane is given", async () => {
    expect(await providerCapability(driver as never).providers()).toEqual([descriptorFor(driver as never)]);
  });

  it("advertises the driver's lane first, then every extra lane", async () => {
    const extra = { id: "gemini-cli", label: "Gemini CLI", accountPool: "stub" };
    const lanes = await providerCapability(driver as never, [extra]).providers();
    expect(lanes.map((lane) => lane.id)).toEqual(["stub", "gemini-cli"]);
  });

  it("resolves lanes supplied as a function, so a plugin can answer from live config", async () => {
    const lanes = await providerCapability(driver as never, () => [{ id: "a", label: "A" }]).providers();
    expect(lanes.map((lane) => lane.id)).toEqual(["stub", "a"]);
  });

  it("answers the driver's lane alone when a lane resolver throws", async () => {
    const lanes = await providerCapability(driver as never, () => {
      throw new Error("config unreadable");
    }).providers();
    expect(lanes.map((lane) => lane.id)).toEqual(["stub"]);
  });

  it("refuses a driver with no handleIr, naming what a provider must implement", () => {
    expect(() => providerCapability({ id: "x", label: "X", models: {} } as never)).toThrow(
      /handleIr/,
    );
  });

  it("builds a capability assignable to the api interface it mirrors", () => {
    interface ApiIrResponse {}
    type ApiIrEventStream = ReadableStream<unknown>;
    interface ApiProviderCapability {
      readonly id: string;
      handleIr(request: never, context: never): Promise<ApiIrResponse | ApiIrEventStream>;
      providers?(): unknown[] | Promise<unknown[]>;
    }
    const built: ApiProviderCapability = providerCapability(driver as never);
    expect(built.id).toBe("stub");
  });

  it("satisfies ProviderDef with only handleIr, no app-wire handle", () => {
    const irOnlyDriver: ProviderDef = {
      id: "ir-only",
      label: "IR Only",
      models: {},
      handleIr: async () => ({ ok: true }),
    };
    expect(providerCapability(irOnlyDriver).id).toBe("ir-only");
  });
});
