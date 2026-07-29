// @ts-nocheck
// Proxy-list fetchers. Free sources fetch live; keyed providers are gated on a
// config key and return [] until one is set. Each returns [{ url, provider }].

async function getText(url, init) {
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), 10000);
  try { const r = await fetch(url, { ...(init || {}), signal: aborter.signal }); return r.ok ? await r.text() : ""; }
  catch { return ""; } finally { clearTimeout(timer); }
}

function linesToProxies(text, provider) {
  return text.split(/\s+/).map((l) => l.trim()).filter(Boolean)
    .map((hostPort) => ({ url: hostPort.startsWith("http") ? hostPort : "http://" + hostPort, provider }));
}

async function proxyscrape() {
  const text = await getText("https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=all&anonymity=all");
  return linesToProxies(text, "proxyscrape");
}

async function proxifly() {
  const text = await getText("https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt");
  return linesToProxies(text, "proxifly");
}

async function pubproxy() {
  const text = await getText("http://pubproxy.com/api/proxy?limit=20&type=http&format=txt");
  return linesToProxies(text, "pubproxy");
}

async function geonix() {
  const text = await getText("https://cdn.jsdelivr.net/gh/TheSpeedX/PROXY-List@master/http.txt");
  return linesToProxies(text, "geonix");
}

async function iplocate() {
  const text = await getText("https://cdn.jsdelivr.net/gh/monosans/proxy-list@main/proxies/http.txt");
  return linesToProxies(text, "iplocate");
}

// keyed/premium providers: wire real endpoints once a key is configured
async function keyed(provider, config) {
  if (!config || !config.key) return [];
  return [];
}

const FREE = { proxyscrape, proxifly, pubproxy, geonix, iplocate };
const KEYED = ["webshare", "brightdata", "oxylabs", "litport"];

// providersConfig: { <name>: { enabled, key? } }; "manual" is never fetched
export async function fetchEnabledProxies(providersConfig) {
  const config = providersConfig || {};
  const out = [];
  for (const [name, fn] of Object.entries(FREE)) {
    if (config[name] && config[name].enabled) { try { out.push(...await fn()); } catch {} }
  }
  for (const name of KEYED) {
    if (config[name] && config[name].enabled) { try { out.push(...await keyed(name, config[name])); } catch {} }
  }
  return out;
}

export const PROXY_PROVIDERS = ["manual", ...Object.keys(FREE), ...KEYED];
