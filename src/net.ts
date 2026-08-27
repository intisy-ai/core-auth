// Single-source proxy-aware transport, lifted out of the per-provider jsExec copies
// (antigravity-auth's and claude-code-auth's driver/javaHandle.ts). Owns ONLY the
// fetch + proxy-retry mechanics; rate-limit status classification stays with the
// caller (it differs per upstream wire format).

/** The minimal proxy-manager shape {@link proxiedFetch} needs: pick a proxy, report how it went. */
export interface ProxyManagerLike {
  /** Picks a proxy URL for an account, or `null` for a direct connection. */
  selectForAccount(accountId?: string, providerId?: string): string | null;
  /** Reports whether a proxy's use succeeded, feeding its quality score. */
  reportResult(url: string, ok: boolean, elapsedMs?: number): void;
}

/** Options to {@link proxiedFetch}. */
export interface ProxiedFetchOpts {
  /** The account this fetch is on behalf of, used to select a sticky proxy. */
  accountId?: string;
  /** The provider this fetch is on behalf of, used to select a proxy when there is no account yet. */
  providerId?: string;
  /** Selects and reports on the proxy; omit for a direct fetch. */
  proxyManager?: ProxyManagerLike;
  /** An already-chosen proxy, used instead of asking the manager for one; needed when the caller has a proxy URL but not the account it belongs to. */
  proxy?: string;
  /** Where diagnostic messages (e.g. a proxy-then-direct retry) go. */
  log?: (message: string) => void;
  /** Test seam only; production callers never set this (defaults to the global fetch). */
  fetchImpl?: typeof fetch;
}

/** Outcome of {@link proxiedFetch}. */
export interface ProxiedFetchResult {
  /** The retained live Response; its body is never read here. */
  response?: Response;
  /** Whether a proxy was applied to the (first) attempt. */
  proxyUsed: boolean;
  /** Whether both the proxied and direct attempts failed to reach the endpoint at all. */
  transportFailed: boolean;
}

// A Request instance's body can only be consumed once; clone it fresh for each
// attempt so a proxy-then-direct retry doesn't hit an already-used-body error.
// A string URL needs no such handling.
function freshInput(request: Request | string): Request | string {
  return request instanceof Request ? request.clone() : request;
}

/**
 * Fetches through a proxy when one is available, retrying directly if the proxy is unreachable
 * (a dead proxy gives no isolation anyway).
 *
 * @remarks Owns only the fetch + proxy-retry mechanics; rate-limit status classification stays with the caller, since it differs per upstream wire format.
 */
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
  if (proxyOk && proxyUrl) opts.proxyManager?.reportResult(proxyUrl, true, Date.now() - started);

  return { response, proxyUsed: !!proxyUrl, transportFailed: false };
}

/**
 * Fetches with a hard deadline, aborting the request if `timeoutMs` elapses first.
 *
 * @param fetchImpl test seam only; production callers never pass it (defaults to the global fetch)
 */
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
