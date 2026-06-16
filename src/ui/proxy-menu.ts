// @ts-nocheck
import { select } from "./select.js";
import { confirm } from "./confirm.js";
import { prompt } from "./prompt.js";
import { isTTY } from "./ansi.js";
import { proxyManager } from "../proxy/manager.js";
import { PROXY_PROVIDERS } from "../proxy/providers.js";

function fmtScore(n) { return (Math.round(n * 10) / 10).toString(); }

async function proxyStats(proxy) {
  const s = proxy.stats || {};
  const items = [
    { label: "provider: " + proxy.provider, kind: "heading", value: 0 },
    { label: "score: " + fmtScore(proxy.score) + " (lower = better)", kind: "heading", value: 0 },
    { label: "in use by: " + proxy.inUse + " / 3 accounts", kind: "heading", value: 0 },
    { label: "checks " + (s.checks || 0) + " · failures " + (s.failures || 0), kind: "heading", value: 0 },
    { label: "avg latency: " + (s.avgLatencyMs || 0) + "ms", kind: "heading", value: 0 },
    { label: "ip rate-limit hits: " + (s.ipRateLimitHits || 0), kind: "heading", value: 0 },
    { label: "last ok: " + (s.lastOkAt ? new Date(s.lastOkAt).toLocaleString() : "never"), kind: "heading", value: 0 },
    { label: "", separator: true, value: 0 },
    { label: "Back", value: "back" },
  ];
  items.push({ label: "Remove this proxy", value: "remove", color: "red" });
  const result = await select(items, { message: proxy.url, clearScreen: true });
  if (result === "remove" && await confirm("Remove " + proxy.url + "?")) proxyManager.remove(proxy.url);
}

async function providerMenu() {
  while (true) {
    const config = proxyManager.providersConfig();
    const items = [{ label: "Back", value: "back" }];
    for (const name of PROXY_PROVIDERS) {
      if (name === "manual") continue;
      const on = config[name] && config[name].enabled;
      items.push({ label: name + (on ? " [on]" : " [off]"), value: name, color: on ? "green" : "yellow" });
    }
    const result = await select(items, { message: "Proxy providers", subtitle: "toggle which sources auto-fetch", clearScreen: true });
    if (!result || result === "back") return;
    proxyManager.enableProvider(result, !(config[result] && config[result].enabled));
  }
}

export async function runProxyMenu() {
  if (!isTTY()) return;
  const expanded = new Set();   // provider categories are collapsed by default
  while (true) {
    const mode = proxyManager.getMode();
    const grouped = proxyManager.byProvider();
    const items = [
      { label: "Mode: " + mode, value: { t: "mode" }, color: "cyan" },
      { label: "Add manual proxy", value: { t: "add" }, color: "cyan" },
      { label: "Refresh from providers", value: { t: "refresh" }, color: "cyan" },
      { label: "Configure providers", value: { t: "providers" }, color: "cyan" },
    ];
    for (const [provider, list] of Object.entries(grouped)) {
      items.push({ label: "", separator: true, value: { t: "noop" } });
      const open = expanded.has(provider);
      items.push({ label: (open ? "▾ " : "▸ ") + provider + " (" + list.length + ")", value: { t: "toggle", provider }, color: "cyan" });
      if (open) for (const p of list) items.push({ label: "   " + p.url, hint: "score " + fmtScore(p.score) + " · in-use " + p.inUse + "/3", value: { t: "proxy", url: p.url } });
    }
    items.push({ label: "", separator: true, value: { t: "noop" } });
    items.push({ label: "Back", value: { t: "back" } });

    const action = await select(items, { message: "Proxies", subtitle: "mode: " + mode + " · Enter a provider to expand", clearScreen: true });
    if (!action || action.t === "back" || action.t === "noop") return;
    if (action.t === "toggle") { if (expanded.has(action.provider)) expanded.delete(action.provider); else expanded.add(action.provider); }
    else if (action.t === "mode") { const m = await select([{ label: "automatic", value: "automatic" }, { label: "manual", value: "manual" }, { label: "disabled", value: "disabled" }], { message: "Proxy mode", clearScreen: true }); if (m) proxyManager.setMode(m); }
    else if (action.t === "add") { const url = await prompt("Proxy URL (host:port or http://...):"); if (url) proxyManager.addManual(url); }
    else if (action.t === "refresh") { process.stdout.write("Fetching…\n"); const n = await proxyManager.refresh(); process.stdout.write("Fetched " + n + " proxies.\n"); }
    else if (action.t === "providers") await providerMenu();
    else if (action.t === "proxy") { const p = proxyManager.get(action.url); if (p) await proxyStats(p); }
  }
}

// manual-mode multi-select of pool proxies for one account
export async function selectAccountProxies(accountId) {
  if (!isTTY()) return;
  while (true) {
    const selected = new Set(proxyManager.getAccountSelection(accountId));
    const all = proxyManager.list();
    if (!all.length) { process.stdout.write("No proxies in the pool — add some via Manage proxies first.\n"); return; }
    const items = [{ label: "Done", value: { t: "done" } }];
    for (const p of all) items.push({ label: (selected.has(p.url) ? "[x] " : "[ ] ") + p.url, hint: p.provider + " · score " + fmtScore(p.score), value: { t: "toggle", url: p.url } });
    const result = await select(items, { message: "Proxies for " + accountId, subtitle: selected.size + " selected (manual mode)", clearScreen: true });
    if (!result || result.t === "done") return;
    if (result.t === "toggle") {
      if (selected.has(result.url)) selected.delete(result.url); else selected.add(result.url);
      proxyManager.setAccountSelection(accountId, [...selected]);
    }
  }
}
