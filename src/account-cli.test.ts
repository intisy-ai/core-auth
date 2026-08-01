import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAccountCli, printAccounts } from "./account-cli.js";
import type { AccountController } from "./types.js";

function fakeAccounts(list: AccountController["list"] = () => []): AccountController {
  return {
    list,
    enable: vi.fn(),
    remove: vi.fn(),
    login: vi.fn(async () => null),
  };
}

describe("runAccountCli", () => {
  let originalArgv: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalArgv = process.argv;
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.argv = originalArgv;
    stdoutSpy.mockRestore();
  });

  it("prints accounts and returns true for list", async () => {
    const accounts = fakeAccounts(() => [
      { id: "acc1", email: "a@example.com", enabled: true, status: "active" },
    ]);
    process.argv = ["node", "cli.js", "list"];
    const login = vi.fn();
    const handled = await runAccountCli({ providerId: "test-provider", driver: { accounts, login } });

    expect(handled).toBe(true);
    const output = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("a@example.com");
    expect(login).not.toHaveBeenCalled();
  });

  it("calls the controller's remove and returns true for remove", async () => {
    const accounts = fakeAccounts();
    process.argv = ["node", "cli.js", "remove", "acc1"];
    const handled = await runAccountCli({ providerId: "test-provider", driver: { accounts, login: vi.fn() } });

    expect(handled).toBe(true);
    expect(accounts.remove).toHaveBeenCalledWith("acc1");
  });

  it("calls the driver's login for login and returns true", async () => {
    const accounts = fakeAccounts();
    const login = vi.fn(async () => null);
    process.argv = ["node", "cli.js", "login", "pasted-code"];
    const handled = await runAccountCli({ providerId: "test-provider", driver: { accounts, login } });

    expect(handled).toBe(true);
    expect(login).toHaveBeenCalledTimes(1);
    expect(login.mock.calls[0][0].code).toBe("pasted-code");
  });

  it("returns false for an unrecognized command", async () => {
    process.argv = ["node", "cli.js", "bogus"];
    const handled = await runAccountCli({ providerId: "test-provider", driver: { accounts: fakeAccounts(), login: vi.fn() } });
    expect(handled).toBe(false);
  });

  it("returns false when no command is given", async () => {
    process.argv = ["node", "cli.js"];
    const handled = await runAccountCli({ providerId: "test-provider", driver: { accounts: fakeAccounts(), login: vi.fn() } });
    expect(handled).toBe(false);
  });
});

describe("printAccounts", () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it("prints a no-accounts message when the list is empty", () => {
    printAccounts("test-provider", fakeAccounts());
    const output = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("No test-provider accounts");
  });

  it("marks a disabled account in its row", () => {
    printAccounts("test-provider", fakeAccounts(() => [
      { id: "acc1", email: "a@example.com", enabled: false, status: "disabled" },
    ]));
    const output = stdoutSpy.mock.calls.map((call) => call[0]).join("");
    expect(output).toContain("a@example.com (disabled)");
  });
});
