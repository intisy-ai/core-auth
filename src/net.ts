// @ts-nocheck
// Single-source proxy-aware transport, lifted out of the per-provider jsExec copies
// (antigravity-auth's and claude-code-auth's driver/javaHandle.ts). Owns ONLY the
// fetch + proxy-retry mechanics; rate-limit status classification stays with the
// caller (it differs per upstream wire format).

export interface ProxyManagerLike {
  selectForAccount(accountId?: string, providerId?: string): string | null;
  reportResult(url: string, ok: boolean, elapsedMs?: number): void;
}

export interface ProxiedFetchOpts {
  accountId?: string;
  providerId?: string;
  proxyManager?: ProxyManagerLike;
  // An already-chosen proxy, used instead of asking the manager for one. A caller that was
  // handed a proxy URL rather than the account it belongs to has nothing to select with.
  proxy?: string;
  log?: (message: string) => void;
  // Test seam only; production callers never set this (defaults to the global fetch).
  fetchImpl?: typeof fetch;
}

export interface ProxiedFetchResult {
  response?: Response;   // retained live Response; body is never read here
  proxyUsed: boolean;    // whether a proxy was applied to the (first) attempt
  transportFailed: boolean;
}

// A Request instance's body can only be consumed once; clone it fresh for each
// attempt so a proxy-then-direct retry doesn't hit an already-used-body error.
// A string URL needs no such handling.
function freshInput(request: Request | string): Request | string {
  return request instanceof Request ? request.clone() : request;
}

export async function proxiedFetch(
  request: Request | string,
  init: RequestInit & { proxy?: string },
  opts: ProxiedFetchOpts = {},
): Promise<ProxiedFetchResult> {
  const log = opts.log || (() => {});
  const doFetch = opts.fetchImpl || fetch;

  const proxyUrl = opts.proxy || (opts.proxyManager ? opts.proxyManager.selectForAccount(opts.accountId, opts.providerId) : null);
  const proxiedInit = proxyUrl ? { ...init, proxy: proxyUrl } : init; // Bun fetch honors .proxy

  let response: Response;
  const started = Date.now();
  let proxyOk = false;
  try {
    response = await doFetch(freshInput(request), proxiedInit);
    proxyOk = !!proxyUrl;
  } catch (error) {
    if (proxyUrl) {
      opts.proxyManager?.reportResult(proxyUrl, false);
      // proxy unreachable -> retry directly (a dead proxy gives no isolation anyway)
      log("fetch via proxy " + proxyUrl + " failed: " + error + ", retrying directly");
      const directInit = { ...init };
      delete directInit.proxy;
      try {
        response = await doFetch(freshInput(request), directInit);
      } catch (directError) {
        log("direct retry failed: " + directError);
        return { transportFailed: true, proxyUsed: true };
      }
    } else {
      log("fetch failed: " + error);
      return { transportFailed: true, proxyUsed: false };
    }
  }
  if (proxyOk) opts.proxyManager?.reportResult(proxyUrl, true, Date.now() - started);

  return { response, proxyUsed: !!proxyUrl, transportFailed: false };
}

// AbortController-based fetch with a hard deadline, lifted out of the ~5 hand-rolled
// AbortController+setTimeout copies across antigravity-auth and claude-code-auth (ping
// checks and quota/model-list calls). fetchImpl is a test seam only; production callers
// never pass it (defaults to the global fetch).
export async function timeoutFetch(
  url: string | Request,
  init: RequestInit = {},
  timeoutMs = 20000,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const aborter = new AbortController();
  const timer = setTimeout(() => aborter.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: aborter.signal });
  } finally {
    clearTimeout(timer);
  }
}
