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

// The catalog to DISPLAY: the fetched/cached list when present, otherwise the provider's
// shipped static fallback (def.models). This lets models be browsed WITHOUT logging in —
// only "Refresh models" (a live fetch) genuinely needs an account. Returns null only when
// the provider ships no static list AND nothing has been fetched (e.g. antigravity before login).
function catalogFor(def) {
  const cache = readModelCache(def.id);
  if (cache && cache.models && Object.keys(cache.models).length) return cache;
  if (def && def.models && Object.keys(def.models).length) return { models: def.models, ranking: Object.keys(def.models), source: "static" };
  return null;
}

// Where the current catalog came from: a live fetch (def.fetchModels) vs the
// provider's shipped static fallback list. Shown so users know if a model list is
// dynamically fetched or the built-in default.
function catalogSourceLabel(providerId) {
  const cache = readModelCache(providerId);
  if (!cache || !cache.source) return "";
  return cache.source === "live" ? "live fetch" : "static fallback";
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
  items.push({ label: "Refresh models", color: "cyan", suspend: true, run: async () => { var msg; try { var c = await refreshModels(def); var n = c ? Object.keys(c).length : 0; msg = n > 0 ? ("Models refreshed (" + n + ")") : "No models returned. Log in first?"; } catch (e) { msg = "Refresh failed: " + (e && e.message || e); } return { refresh: true, flash: msg }; } });
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
  const srcLabel = catalogSourceLabel(providerId);
  const sub = (source === "manual"
    ? "Tries these top-to-bottom, skipping rate-limited ones. Enter a model to reorder/include."
    : "Order is automatic (" + current.label + "). Enter a model to include/exclude.")
    + (srcLabel ? " · models: " + srcLabel : "");
  return { title: def.label + " — Auto model ranking", subtitle: sub, items };
}

// Read-only-ish catalog browser: the FULL model list (not the Auto ranking) with a
// search filter, so a provider's models can be viewed/searched directly. Kept separate
// from buildAutoMenu (which is about ordering/including for Auto). browseQuery lives at
// module scope because only one menu is active at a time; the input prompt + refresh
// re-filters in place (no menu stacking).
let browseQuery = "";
function buildModelsBrowse(def) {
  const providerId = def.id;
  const cat = catalogFor(def);
  const models = (cat && cat.models) || {};
  const order = (cat && cat.ranking && cat.ranking.length) ? cat.ranking : Object.keys(models);
  const q = browseQuery.toLowerCase();
  const matches = order.filter((id) => models[id] && !/-auto$/.test(id)
    && (!q || (id + " " + ((models[id] && models[id].name) || "")).toLowerCase().indexOf(q) >= 0));

  const items = [{ label: "Back", run: () => { browseQuery = ""; return { pop: true }; } }];
  items.push({ label: browseQuery ? "Search: " + browseQuery : "Search…", color: "cyan",
    run: () => ({ input: { title: "Search models", message: "Filter by name or id (empty to clear)", complete: (v) => { browseQuery = v || ""; return { refresh: true }; } } }) });
  if (browseQuery) items.push({ label: "Clear search", run: () => { browseQuery = ""; return { refresh: true }; } });
  items.push({ label: "", separator: true });
  const src = catalogSourceLabel(providerId);
  items.push({ label: "Models (" + matches.length + (browseQuery ? " match" + (matches.length === 1 ? "" : "es") : "") + ")" + (src ? " · " + src : ""), kind: "heading" });
  if (!matches.length) items.push({ label: browseQuery ? "No models match." : "No models — log in or Refresh to fetch this provider's catalog.", kind: "note" });
  for (const id of matches) {
    items.push({ label: (models[id] && models[id].name) || id, hint: id, run: () => ({ push: () => buildAutoModelEdit(def, id) }) });
  }
  return { title: def.label + " — Models", subtitle: "Browse + search this provider's models · Enter a model to include/exclude", items };
}

// ---- Account details --------------------------------------------------------

function buildAccountDetail(def, view) {
  const controller = def.accounts;
  const proxies = !!def.proxies;
  const label = view.email || view.id;
  const extra = typeof controller.accountActions === "function" ? controller.accountActions(view) : [];
  const items = [];
  // This account's own quota bars at the top — this is where the graphs show.
  const bars = accountBars(view);
  if (bars.length) { items.push({ label: "Quota", kind: "heading" }); for (const bar of bars) items.push(bar); items.push({ label: "", separator: true }); }
  items.push({ label: "Back", run: () => ({ pop: true }) });
  items.push({ label: view.enabled === false ? "Enable" : "Disable", color: view.enabled === false ? "green" : "yellow", run: () => { controller.enable(view.id, view.enabled === false); return { pop: true }; } });
  if (proxies) items.push({ label: "Select proxies", color: "cyan", suspend: true, run: async () => { await selectAccountProxies(view.id); return { pop: true }; } });
  extra.forEach((a) => items.push({ label: a.label, color: a.color || "cyan", suspend: true, run: async () => { try { await a.run(); } catch {} return { pop: true }; } }));
  items.push({ label: "Remove", color: "red", suspend: true, run: async () => { if (await confirm(`Remove ${label}?`)) { controller.remove(view.id); return { pop: true }; } return { refresh: true }; } });
  return { title: label + (STATUS[view.status] ? " " + STATUS[view.status] : ""), items };
}

// ---- Top provider menu (accounts + actions) --------------------------------

function fmtDur(ms) {
  if (!isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m";
  return Math.round(m / 60) + "h";
}

// Compact availability hint for the account ROW ("free in Xs" / "available").
// The usage bars live in the account's detail menu, not inline in the row.
// availableAt is Infinity for disabled accounts (never auto-available) — guard on
// isFinite so a disabled/never-limited row shows nothing (the [disabled] status
// label already carries that state) instead of "free in Infinityh".
function accountAvailabilityHint(view) {
  const now = Date.now();
  if (typeof view.availableAt === "number" && isFinite(view.availableAt) && view.availableAt > now) return "free in " + fmtDur(view.availableAt - now);
  if (view.status === "active") return "available";
  return "";
}

// Shared quota-area builder: pushes bars, or an explanatory note for whichever
// reason there are none (never silently blank). Used by the Quota submenu.
function pushQuotaArea(items, def, views) {
  if (def.quotaDisabled === true) { items.push({ label: "Quota display is disabled for this provider.", kind: "note" }); return; }
  if (!views.length) { items.push({ label: "Add an account to see quota.", kind: "note" }); return; }
  // Only enabled accounts contribute quota (quotaBars skips disabled). If none are
  // enabled, nothing will ever load — say so instead of a perpetual "Loading quota…".
  if (!views.some((v) => v.enabled !== false)) { items.push({ label: "No enabled accounts — enable or add one to see quota.", kind: "note" }); return; }
  const bars = quotaBars(views);
  if (bars.length) { for (const bar of bars) items.push(bar); return; }
  if (typeof def.accounts.refreshQuota === "function") items.push({ label: "Loading quota…", kind: "note" });
  else items.push({ label: "This provider does not report quota usage.", kind: "note" });
}

// Global quota view: bars aggregated across ALL accounts (the combined graphs).
function buildQuotaMenu(def) {
  const controller = def.accounts;
  const views = controller.list();
  const items = [{ label: "Back", run: () => ({ pop: true }) }];
  if (typeof controller.refreshQuota === "function") items.push({ label: "Refresh quotas", color: "cyan", suspend: true, run: async () => { try { await controller.refreshQuota(true); } catch {} return { refresh: true }; } });
  items.push({ label: "", separator: true });
  pushQuotaArea(items, def, views);
  // Provider-supplied footnote (e.g. a pool whose quota the API doesn't report) —
  // provider-agnostic: core just renders whatever string the driver declares.
  if (typeof def.quotaNote === "string" && def.quotaNote) {
    items.push({ label: "", separator: true });
    items.push({ label: def.quotaNote, kind: "note" });
  }
  // refetch on open so the graphs are current even if the parent didn't just fetch
  const onOpen = typeof controller.refreshQuota === "function" ? async () => { try { await controller.refreshQuota(); } catch {} } : undefined;
  return { title: def.label + " — Quota (all accounts)", subtitle: "Combined across accounts · Esc to go back", items, onOpen };
}

// Less-used provider actions, grouped off the main menu into labeled sections.
function buildManageMenu(def) {
  const controller = def.accounts;
  const proxies = !!def.proxies;
  const extraActions = typeof controller.actions === "function" ? controller.actions() : [];
  const items = [{ label: "Back", run: () => ({ pop: true }) }];

  // Models moved to the provider menu's own Models section (Browse/Configure/Refresh)
  // so they aren't duplicated here.
  if (proxies) {
    items.push({ label: "", separator: true });
    items.push({ label: "Network", kind: "heading" });
    items.push({ label: "Manage proxies", color: "cyan", run: () => ({ push: () => buildProxyMenu() }) });
  }
  if (def.settings && (def.settings.groups || []).length) {
    items.push({ label: "", separator: true });
    items.push({ label: "Provider", kind: "heading" });
    items.push({ label: "Settings", color: "cyan", run: () => ({ push: () => buildSettingsMenu(def) }) });
  }
  if (extraActions.length) {
    items.push({ label: "", separator: true });
    items.push({ label: "Accounts", kind: "heading" });
    extraActions.forEach((a) => items.push({ label: a.label, color: a.color || "cyan", suspend: true, run: async () => { try { await a.run(); } catch (e) { process.stderr.write(String(e) + "\n"); } return { refresh: true }; } }));
  }
  return { title: def.label + " — Manage", subtitle: "Esc to go back", items };
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

// resetTime may be epoch ms (number) or an ISO string; normalize to epoch ms.
function resetToMs(reset) {
  if (typeof reset === "number") return reset;
  if (typeof reset === "string" && reset) { const t = Date.parse(reset); return Number.isFinite(t) ? t : NaN; }
  return NaN;
}

// One bar row ({ kind:"bar", label, fraction=USED 0..1, reset }) per quota pool.
function barsFromPools(pools) {
  return pools
    .filter((p) => p && typeof p.remainingFraction === "number")
    .map((p) => {
      const ms = resetToMs(p.resetTime);
      return { kind: "bar", label: p.label, fraction: Math.max(0, Math.min(1, 1 - p.remainingFraction)), reset: Number.isFinite(ms) ? fmtReset(ms) : "" };
    });
}

// Per-account quota pools -> bar rows (for the account-detail menu).
function accountBars(view) {
  return Array.isArray(view.quota) ? barsFromPools(view.quota) : [];
}

// Real per-pool quota aggregated across accounts as Claude-/usage-style bar rows.
// Empty when no enabled account reports remainingFraction (e.g. before the first
// quota fetch, or a provider with no quota API) — no bar is ever faked.
function quotaBars(views) {
  const pools = {};
  for (const v of views) {
    if (v.enabled === false || !Array.isArray(v.quota)) continue;
    for (const q of v.quota) {
      if (!q || typeof q.remainingFraction !== "number") continue;
      const p = pools[q.label] || (pools[q.label] = { label: q.label, fracs: [], reset: null });
      p.fracs.push(q.remainingFraction);
      const ms = resetToMs(q.resetTime);
      if (Number.isFinite(ms) && (p.reset == null || ms < p.reset)) p.reset = ms;
    }
  }
  return barsFromPools(Object.values(pools).map((p) => ({
    label: p.label, remainingFraction: p.fracs.reduce((a, b) => a + b, 0) / p.fracs.length, resetTime: p.reset,
  })));
}

export function buildAccountMenu(def) {
  const controller = def.accounts;
  const views = controller.list();

  // Add account: providers with a URL-based loginFlow open the browser + show the
  // URL in-chrome and auto-capture via loopback where supported, with an in-tab
  // pasted code as the fallback (buildLoginInput — an async, NON-suspend action so
  // the renderer keeps the TUI live instead of dropping to the raw terminal).
  // Providers without a loginFlow fall back to their own login() (suspend).
  const addAccount = typeof def.loginFlow === "function"
    ? { label: "Add account", color: "cyan", run: () => buildLoginInput(def) }
    : { label: "Add account", color: "cyan", suspend: true, run: async () => { try { await controller.login(); await refreshModels(def); } catch (e) { process.stderr.write(String(e) + "\n"); } return { refresh: true }; } };

  // Main menu in labeled sections: Accounts (list + Add), Usage (global graphs),
  // Settings & tools (Manage submenu + Delete). Per-account bars show on click
  // (buildAccountDetail); the rarely-used actions live under Manage.
  const items = [];
  const note = availabilityNote(views);
  items.push({ label: `Accounts (${views.length})`, hint: note || undefined, kind: "heading" });
  if (!views.length) items.push({ label: "No accounts yet — add one below.", kind: "note" });
  for (const view of views) {
    const hint = [view.detail, accountAvailabilityHint(view)].filter(Boolean).join(" · ");
    items.push({ label: `${view.email || view.id}${STATUS[view.status] ? " " + STATUS[view.status] : ""}`, hint, run: () => ({ push: () => buildAccountDetail(def, view) }) });
  }
  items.push(addAccount);

  // Quota is per-account, so it only makes sense once you're logged in — gate on accounts
  // (unlike Models, which are browsable from the static catalog without an account).
  if (views.length > 0) {
    items.push({ label: "", separator: true });
    items.push({ label: "Usage", kind: "heading" });
    items.push({ label: "Quota", hint: "all-account graphs", color: "cyan", run: () => ({ push: () => buildQuotaMenu(def) }) });
  }

  // Models live directly on the provider menu (one place, not duplicated in Manage):
  // Browse (view + search the full catalog), Configure Auto models (ranking), Refresh.
  if (catalogFor(def)) {
    items.push({ label: "", separator: true });
    items.push({ label: "Models", kind: "heading" });
    items.push({ label: "Browse models", hint: "view + search", color: "cyan", run: () => { browseQuery = ""; return { push: () => buildModelsBrowse(def) }; } });
    items.push({ label: "Configure Auto models", hint: "ranking / include-exclude", color: "cyan", run: () => ({ push: () => buildAutoMenu(def) }) });
    items.push({ label: "Refresh models", color: "cyan", suspend: true, run: async () => { var msg; try { var c = await refreshModels(def); var n = c ? Object.keys(c).length : 0; msg = n > 0 ? ("Models refreshed (" + n + ")") : "No models returned. Log in first?"; } catch (e) { msg = "Refresh failed: " + (e && e.message || e); } return { refresh: true, flash: msg }; } });
  }

  items.push({ label: "", separator: true });
  items.push({ label: "Settings & tools", kind: "heading" });
  items.push({ label: "Manage", hint: "proxies · settings", color: "cyan", run: () => ({ push: () => buildManageMenu(def) }) });
  if (views.length > 0) items.push({ label: "Delete all accounts", color: "red", suspend: true, run: async () => { if (await confirm("Delete ALL accounts? This cannot be undone.")) { for (const v of controller.list()) controller.remove(v.id); } return { refresh: true }; } });

  // No "Done" item — Esc backs out / exits (Done caused select() quirks + is redundant).
  // onOpen: renderers call it once on open so quota is fetched in the background and
  // ready when the user opens Quota / an account (no bars clutter the main list).
  const onOpen = typeof controller.refreshQuota === "function"
    ? async () => { try { await controller.refreshQuota(); } catch {} }
    : undefined;
  return { title: def.label + " accounts", subtitle: "Esc to exit · Enter an action or account", items, providerLabel: def.label, onOpen };
}
