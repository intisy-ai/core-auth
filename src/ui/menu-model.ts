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
import { selectAccountProxies } from "./proxy-menu.js";
import { getAutoConfig, setAutoConfig } from "../config.js";
import { readModelCache } from "../models-cache.js";
import { buildLoginInput } from "./url-auth.js";
import { buildSettingsMenu } from "./settings-menu.js";
import { refreshModels } from "../refresh.js";

// ---- Proxy menu (native model) ---------------------------------------------

function buildProxyDetail(url) {
  return { title: url, items: [
    { label: "Back", run: () => ({ pop: true }) },
    { label: "Remove this proxy", color: "red", suspend: true, run: async () => { if (await confirm("Remove " + url + "?")) { proxyManager.remove(url); return { pop: true }; } return { refresh: true }; } },
  ] };
}

function buildProxyMenu() {
  const mode = proxyManager.getMode();
  const grouped = proxyManager.byProvider() || {};
  const items = [
    { label: "Back", run: () => ({ pop: true }) },
    { label: "Mode: " + mode, color: "cyan", run: () => { const order = ["automatic", "manual", "disabled"]; const i = order.indexOf(mode); proxyManager.setMode(order[(i + 1) % order.length]); return { refresh: true }; } },
    { label: "Add proxy", color: "green", run: () => ({ input: { title: "Proxy URL", message: "Enter a proxy (host:port or http://...)", complete: (url) => { proxyManager.addManual(url); return { refresh: true }; } } }) },
    { label: "Refresh from providers", color: "cyan", suspend: true, run: async () => { try { await proxyManager.refresh(); } catch {} return { refresh: true }; } },
  ];
  for (const provider of Object.keys(grouped)) {
    const list = grouped[provider] || [];
    if (!list.length) continue;
    items.push({ label: "", separator: true });
    items.push({ label: provider + " (" + list.length + ")", kind: "heading" });
    for (const p of list) items.push({ label: p.url, hint: "score " + (typeof p.score === "number" ? p.score.toFixed(2) : "?") + " · in-use " + (p.inUse || 0), run: ((u) => () => ({ push: () => buildProxyDetail(u) }))(p.url) });
  }
  return { title: "Proxies", subtitle: "mode: " + mode + " · Esc to go back", items };
}

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
  // Re-fetch the catalog and RECOMPUTE the sort orders (leaderboard etc.) in place — the
  // displayed order is the cached sortOrders, so without this the list only updates on an
  // app restart / login. Rebuilds the menu (refresh) so the new order shows immediately.
  items.push({ label: "Refresh models", color: "cyan", suspend: true, run: async () => { try { await refreshModels(def); } catch {} return { refresh: true }; } });
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

function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m";
  return Math.round(m / 60) + "h";
}

// Per-account quota/availability for the row hint: real per-pool remaining % when the
// provider supplies quota, else availability ("free in Xs" / "available").
function accountQuotaHint(view) {
  if (Array.isArray(view.quota) && view.quota.length) {
    const pools = view.quota
      .filter((q) => q && typeof q.remainingFraction === "number")
      .map((q) => q.label + " " + Math.round(q.remainingFraction * 100) + "%");
    if (pools.length) return pools.join(" · ");
  }
  const now = Date.now();
  if (typeof view.availableAt === "number" && view.availableAt > now) return "free in " + fmtDur(view.availableAt - now);
  if (view.status === "active") return "available";
  return "";
}

function fmtReset(ms) {
  try { return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return ""; }
}

// One-line availability summary across enabled accounts: how many are usable now
// and when the next one frees up. Rendered dim under the Accounts heading (kind
// "note"); it's the honest signal for providers with no remaining-% quota API.
function availabilityNote(views) {
  const now = Date.now();
  const enabled = views.filter((v) => v.enabled !== false);
  if (!enabled.length) return "";
  const unavailable = enabled.filter((v) => typeof v.availableAt === "number" && v.availableAt > now);
  let line = (enabled.length - unavailable.length) + "/" + enabled.length + " available";
  if (unavailable.length) {
    const next = Math.min.apply(null, unavailable.map((v) => v.availableAt));
    if (isFinite(next)) line += " · next free in " + fmtDur(next - now);
  }
  return line;
}

// Real per-pool quota aggregated across accounts as Claude-/usage-style bar rows
// ({ kind:"bar", label, fraction=USED 0..1, reset }). Empty when the provider
// exposes no remaining-% quota (e.g. antigravity) — no bar is ever faked.
function quotaBars(views) {
  const pools = {};
  for (const v of views) {
    if (v.enabled === false || !Array.isArray(v.quota)) continue;
    for (const q of v.quota) {
      if (!q || typeof q.remainingFraction !== "number") continue;
      const p = pools[q.label] || (pools[q.label] = { fracs: [], reset: null });
      p.fracs.push(q.remainingFraction);
      if (typeof q.resetTime === "number" && (p.reset == null || q.resetTime < p.reset)) p.reset = q.resetTime;
    }
  }
  return Object.keys(pools).map((label) => {
    const p = pools[label];
    const remaining = p.fracs.reduce((a, b) => a + b, 0) / p.fracs.length;
    return { kind: "bar", label, fraction: Math.max(0, Math.min(1, 1 - remaining)), reset: p.reset != null ? fmtReset(p.reset) : "" };
  });
}

export function buildAccountMenu(def) {
  const controller = def.accounts;
  const proxies = !!def.proxies;
  const views = controller.list();
  const extraActions = (typeof controller.actions === "function" ? controller.actions() : []).slice();
  if (readModelCache(def.id)) extraActions.push({ label: "Configure Auto models", color: "cyan", auto: true });

  // Add account: providers with a URL-based loginFlow open the browser + show the
  // URL in-chrome and auto-capture via loopback where supported, with an in-tab
  // pasted code as the fallback (buildLoginInput — an async, NON-suspend action so
  // the renderer keeps the TUI live instead of dropping to the raw terminal).
  // Providers without a loginFlow fall back to their own login() (suspend).
  const addAccount = typeof def.loginFlow === "function"
    ? { label: "Add account", color: "cyan", run: () => buildLoginInput(def) }
    : { label: "Add account", color: "cyan", suspend: true, run: async () => { try { await controller.login(); await refreshModels(def); } catch (e) { process.stderr.write(String(e) + "\n"); } return { refresh: true }; } };

  const items = [{ label: "Actions", kind: "heading" }, addAccount];
  // Pull the provider's model catalog on demand (live fetch when authed, else static/
  // cached) and write it into the host config — so models + "Configure Auto models"
  // appear without waiting for an app restart.
  items.push({ label: "Refresh models", color: "cyan", suspend: true, run: async () => { try { await refreshModels(def); } catch {} return { refresh: true }; } });
  if (typeof controller.refreshQuota === "function") items.push({ label: "Refresh quotas", color: "cyan", suspend: true, run: async () => { try { await controller.refreshQuota(); } catch {} return { refresh: true }; } });
  if (proxies) items.push({ label: "Manage proxies", color: "cyan", run: () => ({ push: () => buildProxyMenu() }) });
  if (def.settings && (def.settings.groups || []).length) items.push({ label: "Settings", color: "cyan", run: () => ({ push: () => buildSettingsMenu(def) }) });
  extraActions.forEach((a) => {
    if (a.auto) items.push({ label: a.label, color: a.color || "cyan", run: () => ({ push: () => buildAutoMenu(def) }) });
    else items.push({ label: a.label, color: a.color || "cyan", suspend: true, run: async () => { try { await a.run(); } catch (e) { process.stderr.write(String(e) + "\n"); } return { refresh: true }; } });
  });
  items.push({ label: "", separator: true });
  items.push({ label: `Accounts (${views.length})`, kind: "heading" });
  const note = availabilityNote(views);
  if (note) items.push({ label: note, kind: "note" });
  for (const bar of quotaBars(views)) items.push(bar);
  for (const view of views) {
    const hint = [view.detail, accountQuotaHint(view)].filter(Boolean).join(" · ");
    items.push({ label: `${view.email || view.id}${STATUS[view.status] ? " " + STATUS[view.status] : ""}`, hint: hint, run: () => ({ push: () => buildAccountDetail(def, view) }) });
  }
  if (views.length > 0) { items.push({ label: "", separator: true }); items.push({ label: "Delete all accounts", color: "red", suspend: true, run: async () => { if (await confirm("Delete ALL accounts? This cannot be undone.")) { for (const v of controller.list()) controller.remove(v.id); } return { refresh: true }; } }); }

  // No "Done" item — Esc backs out / exits (Done caused select() quirks + is redundant).
  return { title: def.label + " accounts", subtitle: "Esc to exit · Enter an action or account", items, providerLabel: def.label };
}
