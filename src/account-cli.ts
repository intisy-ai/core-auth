// Single-source standalone account CLI (login/list/remove), lifted out of the
// near-identical antigravity-auth and claude-code-auth cli.ts copies. A provider
// supplies a small driver (its already-built AccountController + the raw all-in-one
// login it uses standalone, distinct from the split loginFlow the opencode oauth
// method drives) and gets the whole login/list/remove dispatch for free.

import type { AccountController } from "./types.js";

/** Options passed to a driver's `login` for the CLI's `login` command. */
export interface AccountCliLoginOpts {
  /** Where progress messages go. */
  log: (message: string) => void;
  /** A pasted code or redirect URL for a non-interactive completion. */
  code?: string;
}

/** What a provider supplies {@link runAccountCli} to get the login/list/remove dispatch for free. */
export interface AccountCliDriver {
  /** The provider's already-built account controller, for the `list` and `remove` commands. */
  accounts: AccountController;
  /** The raw all-in-one login this CLI drives standalone, distinct from the split loginFlow the opencode oauth method uses. */
  login: (opts: AccountCliLoginOpts) => Promise<unknown>;
}

/** Options to {@link runAccountCli}. */
export interface RunAccountCliOpts {
  /** Used in the CLI's own usage/status messages. */
  providerId: string;
  /** What the CLI dispatches into for `login`/`list`/`remove`. */
  driver: AccountCliDriver;
}

/** Prints a provider's accounts to stdout, one per line, marking disabled ones. */
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

/**
 * Dispatches `process.argv`'s `login`/`list`/`remove` account CLI commands.
 *
 * @returns `true` when argv named a recognized command and it was handled, so the caller should
 * exit; `false` when nothing matched, so the caller decides what to do next (e.g. fall through to
 * another CLI or print its own usage).
 */
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
