// @ts-nocheck
// Runs the shared account-management menu for a provider def. Used by the opencode
// oauth authorize() and by the Claude loader (which suspends its TUI to call this).
import { runAccountMenu } from "./ui/account-menu.js";
import { runAutoMenu } from "./ui/auto-menu.js";
import { readModelCache } from "./models-cache.js";

export async function runProviderMenu(def) {
  if (!def || !def.accounts) return;
  const actions = typeof def.accounts.actions === "function" ? def.accounts.actions() : [];
  // Auto ranking/inclusion editor — shown once a catalog has been fetched.
  if (readModelCache(def.id)) {
    actions.push({ label: "Configure Auto models", color: "cyan", run: () => runAutoMenu(def) });
  }
  await runAccountMenu(def.accounts, { label: def.label, actions, proxies: !!def.proxies });
}
