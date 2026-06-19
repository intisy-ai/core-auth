// @ts-nocheck
// Host-agnostic MENU MODEL for the provider menu (accounts) + Auto editor. Builds
// the items + their actions ONCE; a renderer (select() standalone, or the loader's
// native tab renderer) draws the model in its own style. This is what lets the
// loader show the exact same content/logic as `oc auth login` without duplicating it.
//
// An item's run() returns a navigation action the renderer interprets:
//   { push: Menu }  open a submenu      { pop: true }  go back
//   { close: true } exit the whole menu { refresh: true } rebuild current menu
//   (void)          stay (renderer rebuilds the menu to reflect changed state)
// Items with `suspend: true` need a clean terminal (login, proxy pickers, confirm
// prompts); the loader renderer runs those via runBlocking, select() runs inline.

import { confirm } from "./confirm.js";
import { proxyManager } from "../proxy/manager.js";
import { runProxyMenu, selectAccountProxies } from "./proxy-menu.js";
import { getAutoConfig, setAutoConfig } from "../config.js";
import { readModelCache } from "../models-cache.js";

const STATUS = {
  active: "[active]", "rate-limited": "[rate-limited]", "cooling-down": "[cooling]",
  "verification-required": "[needs verification]", disabled: "[disabled]",
};

function modelName(providerId, id) {
  const cache = readModelCache(providerId);
  const m = cache && cache.models && cache.models[id];
  return (m && m.name) || id;
}

// ---- Auto editor (model ranking) -------------------------------------------

function buildAutoModelEdit(def, id) {
  const providerId = def.id;
  const { order, excluded, source } = getAutoConfig(providerId);
  const included = !excluded.includes(id);
  const pos = order.indexOf(id);
  const items = [
    { label: "Back", run: () => ({ pop: true }) },
    {
      label: included ? "Exclude" : "Include", color: included ? "yellow" : "green",
      run: () => { setAutoConfig(providerId, { excluded: included ? [...excluded, id] : excluded.filter((x) => x !== id) }); return { pop: true }; },
    },
  ];
  if (source === "manual") {
    items.push({ label: "Move up", run: () => { if (pos > 0) { const n = order.slice(); [n[pos - 1], n[pos]] = [n[pos], n[pos - 1]]; setAutoConfig(providerId, { order: n }); } return { pop: true }; } });
    items.push({ label: "Move down", run: () => { if (pos >= 0 && pos < order.length - 1) { const n = order.slice(); [n[pos + 1], n[pos]] = [n[pos], n[pos + 1]]; setAutoConfig(providerId, { order: n }); } return { pop: true }; } });
  }
  return { title: modelName(providerId, id), items };
}

export function buildAutoMenu(def) {
  const providerId = def.id;
  const { order, excluded, source, sources } = getAutoConfig(providerId);
  const current = sources.find((s) => s.id === source) || sources[0] || { id: "manual", label: "Manual" };
  const items = [];
  if (sources.length > 1) {
    items.push({
      label: "Sort: " + current.label, color: "cyan",
      run: () => { const i = sources.findIndex((s) => s.id === source); setAutoConfig(providerId, { source: sources[(i + 1) % sources.length].id }); return { refresh: true }; },
    });
  }
  if (source === "manual") items.push({ label: "Reset to default order", color: "yellow", run: () => { setAutoConfig(providerId, { order: [] }); return { refresh: true }; } });
  items.push({ label: "", separator: true });
  items.push({ label: "Models (top = preferred)", kind: "heading" });
  order.forEach((id, i) => {
    const inc = !excluded.includes(id);
    items.push({ label: (inc ? "[x] " : "[ ] ") + (i + 1) + ". " + modelName(providerId, id), hint: inc ? "" : "excluded", run: () => ({ push: () => buildAutoModelEdit(def, id) }) });
  });
  const sub = source === "manual"
    ? "Tries these top-to-bottom, skipping rate-limited ones. Enter a model to reorder/include."
    : "Order is automatic (" + current.label + "). Enter a model to include/exclude.";
  return { title: def.label + " — Auto model ranking", subtitle: sub, items };
}

// ---- Account details --------------------------------------------------------

function buildAccountDetail(def, view) {
  const controller = def.accounts;
  const proxies = !!def.proxies;
  const label = view.email || view.id;
  const extra = typeof controller.accountActions === "function" ? controller.accountActions(view) : [];
  const items = [
    { label: "Back", run: () => ({ pop: true }) },
    { label: view.enabled === false ? "Enable" : "Disable", color: view.enabled === false ? "green" : "yellow", run: () => { controller.enable(view.id, view.enabled === false); return { pop: true }; } },
  ];
  if (proxies) items.push({ label: "Select proxies", color: "cyan", suspend: true, run: async () => { await selectAccountProxies(view.id); return { pop: true }; } });
  extra.forEach((a) => items.push({ label: a.label, color: a.color || "cyan", suspend: true, run: async () => { try { await a.run(); } catch {} return { pop: true }; } }));
  items.push({ label: "Remove", color: "red", suspend: true, run: async () => { if (await confirm(`Remove ${label}?`)) { controller.remove(view.id); return { pop: true }; } return { refresh: true }; } });
  return { title: label + (STATUS[view.status] ? " " + STATUS[view.status] : ""), items };
}

// ---- Top provider menu (accounts + actions) --------------------------------

export function buildAccountMenu(def) {
  const controller = def.accounts;
  const proxies = !!def.proxies;
  const views = controller.list();
  const extraActions = (typeof controller.actions === "function" ? controller.actions() : []).slice();
  if (readModelCache(def.id)) extraActions.push({ label: "Configure Auto models", color: "cyan", auto: true });

  const items = [
    { label: "Actions", kind: "heading" },
    { label: "Add account", color: "cyan", suspend: true, run: async () => { try { await controller.login(); } catch (e) { process.stderr.write(String(e) + "\n"); } return { refresh: true }; } },
  ];
  if (typeof controller.refreshQuota === "function") items.push({ label: "Refresh quotas", color: "cyan", suspend: true, run: async () => { try { await controller.refreshQuota(); } catch {} return { refresh: true }; } });
  if (proxies) items.push({ label: "Manage proxies", color: "cyan", suspend: true, run: async () => { await runProxyMenu(); return { refresh: true }; } });
  extraActions.forEach((a) => {
    if (a.auto) items.push({ label: a.label, color: a.color || "cyan", run: () => ({ push: () => buildAutoMenu(def) }) });
    else items.push({ label: a.label, color: a.color || "cyan", suspend: true, run: async () => { try { await a.run(); } catch (e) { process.stderr.write(String(e) + "\n"); } return { refresh: true }; } });
  });
  items.push({ label: "", separator: true });
  items.push({ label: `Accounts (${views.length})`, kind: "heading" });
  for (const view of views) {
    items.push({ label: `${view.email || view.id}${STATUS[view.status] ? " " + STATUS[view.status] : ""}`, hint: view.detail || "", run: () => ({ push: () => buildAccountDetail(def, view) }) });
  }
  if (views.length > 0) { items.push({ label: "", separator: true }); items.push({ label: "Delete all accounts", color: "red", suspend: true, run: async () => { if (await confirm("Delete ALL accounts? This cannot be undone.")) { for (const v of controller.list()) controller.remove(v.id); } return { refresh: true }; } }); }

  // No "Done" item — Esc backs out / exits (Done caused select() quirks + is redundant).
  return { title: def.label + " accounts", subtitle: "Esc to exit · Enter an action or account", items, providerLabel: def.label };
}
