// Single-source standalone account CLI (login/list/remove), lifted out of the
// near-identical antigravity-auth and claude-code-auth cli.ts copies. A provider
// supplies a small driver (its already-built AccountController + the raw all-in-one
// login it uses standalone, distinct from the split loginFlow the opencode oauth
// method drives) and gets the whole login/list/remove dispatch for free.

import type { AccountController } from "./types.js";

export interface AccountCliLoginOpts {
  log: (message: string) => void;
  code?: string;   // pasted code / redirect URL for a non-interactive completion
}

export interface AccountCliDriver {
  accounts: AccountController;
  login: (opts: AccountCliLoginOpts) => Promise<unknown>;
}

export interface RunAccountCliOpts {
  providerId: string;
  driver: AccountCliDriver;
}

export function printAccounts(providerId: string, accounts: AccountController): void {
  const views = accounts.list();
  if (!views.length) {
    process.stdout.write(`No ${providerId} accounts. Run \`${providerId} login\`.\n`);
    return;
  }
  for (const view of views) {
    const state = view.enabled === false ? " (disabled)" : "";
    process.stdout.write("- " + (view.email || view.id) + state + "\n");
  }
}

function printAccountCliUsage(providerId: string): void {
  process.stderr.write(`usage: ${providerId} <login|list|remove <id>>\n`);
}

// Returns true when argv named a recognized command (login/list/remove) and it was
// handled, so the caller should exit; false when nothing matched (caller decides
// what to do next, e.g. fall through to another CLI or print its own usage).
export async function runAccountCli(opts: RunAccountCliOpts): Promise<boolean> {
  const { providerId, driver } = opts;
  const [command, argument] = process.argv.slice(2);

  switch (command) {
    case "login":
      await driver.login({ log: (message) => process.stdout.write(message + "\n"), code: argument });
      return true;
    case "list":
      printAccounts(providerId, driver.accounts);
      return true;
    case "remove":
      if (!argument) {
        printAccountCliUsage(providerId);
        process.exitCode = 1;
        return true;
      }
      driver.accounts.remove(argument);
      process.stdout.write("Removed " + argument + ".\n");
      return true;
    default:
      return false;
  }
}
