// @ts-nocheck
// Generic account-management TUI: lists a provider's accounts (via its
// AccountController) with status/quota, and offers add/enable/disable/remove.
// "Add account" runs the provider's login() (its OAuth flow). Provider-agnostic.
import { select } from "./select.js";
import { confirm } from "./confirm.js";
import { isTTY, ANSI } from "./ansi.js";

const STATUS_BADGE = {
  active: `${ANSI.green}[active]${ANSI.reset}`,
  "rate-limited": `${ANSI.yellow}[rate-limited]${ANSI.reset}`,
  "cooling-down": `${ANSI.yellow}[cooling]${ANSI.reset}`,
  "verification-required": `${ANSI.red}[needs verification]${ANSI.reset}`,
  disabled: `${ANSI.red}[disabled]${ANSI.reset}`,
};

function quotaHint(view) {
  if (!view.quota || !view.quota.length) return "";
  return view.quota
    .map((q) => `${q.label || ""} ${typeof q.remainingFraction === "number" ? Math.round(q.remainingFraction * 100) + "%" : "?"}`)
    .join("  ");
}

async function accountDetails(controller, view) {
  const label = view.email || view.id;
  const extra = typeof controller.accountActions === "function" ? controller.accountActions(view) : [];
  const items = [
    { label: "Back", value: { type: "back" } },
    { label: view.enabled === false ? "Enable" : "Disable", value: { type: "toggle" }, color: view.enabled === false ? "green" : "yellow" },
  ];
  extra.forEach((action, i) => items.push({ label: action.label, value: { type: "action", index: i }, color: action.color || "cyan" }));
  items.push({ label: "Remove", value: { type: "remove" }, color: "red" });

  const result = await select(items, { message: `${label}${STATUS_BADGE[view.status] ? " " + STATUS_BADGE[view.status] : ""}`, clearScreen: true });
  if (!result || result.type === "back") return;
  if (result.type === "toggle") controller.enable(view.id, view.enabled === false);
  else if (result.type === "remove") { if (await confirm(`Remove ${label}?`)) controller.remove(view.id); }
  else if (result.type === "action") { try { await extra[result.index].run(); } catch (error) { process.stderr.write(String(error) + "\n"); } }
}

export async function runAccountMenu(controller, opts) {
  const label = (opts && opts.label) || "Accounts";
  const extraActions = (opts && opts.actions) || [];
  if (!isTTY()) { try { await controller.login(); } catch {} return; }

  while (true) {
    const views = controller.list();
    const items = [
      { label: "Actions", value: { type: "noop" }, kind: "heading" },
      { label: "Add account", value: { type: "add" }, color: "cyan" },
    ];
    if (typeof controller.refreshQuota === "function") items.push({ label: "Refresh quotas", value: { type: "quota" }, color: "cyan" });
    extraActions.forEach((action, i) => items.push({ label: action.label, value: { type: "action", index: i }, color: action.color || "cyan" }));
    items.push({ label: "", value: { type: "noop" }, separator: true });
    items.push({ label: `Accounts (${views.length})`, value: { type: "noop" }, kind: "heading" });
    for (const view of views) {
      const badge = STATUS_BADGE[view.status] || "";
      items.push({
        label: `${view.email || view.id}${badge ? " " + badge : ""}`,
        hint: view.detail || quotaHint(view),
        value: { type: "account", view },
      });
    }
    items.push({ label: "", value: { type: "noop" }, separator: true });
    if (views.length > 0) items.push({ label: "Delete all accounts", value: { type: "delete-all" }, color: "red" });
    items.push({ label: "Done", value: { type: "done" } });

    const action = await select(items, { message: `${label} accounts`, subtitle: "Select an action or account", clearScreen: true });
    if (!action || action.type === "done" || action.type === "noop") return;
    if (action.type === "add") { try { await controller.login(); } catch (error) { process.stderr.write(String(error) + "\n"); } }
    else if (action.type === "quota") { try { await controller.refreshQuota(); } catch {} }
    else if (action.type === "action") { try { await extraActions[action.index].run(); } catch (error) { process.stderr.write(String(error) + "\n"); } }
    else if (action.type === "delete-all") { if (await confirm("Delete ALL accounts? This cannot be undone.")) for (const view of controller.list()) controller.remove(view.id); }
    else if (action.type === "account") await accountDetails(controller, action.view);
  }
}
