// Runs the shared account-management menu for a provider def. Used by the opencode
// oauth authorize() and by the Claude loader (which suspends its TUI to call this).
import { runMenu } from "./ui/menu-render.js";
import { buildAccountMenu } from "./ui/menu-model.js";
import { isTTY } from "./ui/ansi.js";
import type { ProviderDef } from "./types.js";

/**
 * Runs the shared account-management menu for a provider, via the standalone `select()` renderer.
 *
 * @remarks Standalone entry (`oc auth login` / `handler.menu()`); the loader renders the same menu model natively. A no-op when the provider has no accounts or stdout is not a TTY.
 */
export async function runProviderMenu(def: ProviderDef): Promise<void> {
  if (!def || !def.accounts || !isTTY()) return;
  await runMenu(() => buildAccountMenu(def));
}
