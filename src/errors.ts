// @ts-nocheck
import { getCoreAuth } from "./core-auth-loader.js";

// Let a provider surface a TERMINAL error into the chat instead of looping forever.
//
// Both hosts retry "transient" upstream statuses (429 rate_limit, 500 api_error,
// 503, 529 overloaded), so returning those for a permanent condition (all accounts
// spent for hours, auth broken, no accounts) makes the client retry endlessly. An
// Anthropic 400 invalid_request_error (and 401/403) is instead shown to the user and
// NOT retried. chatError() returns that shape so `message` appears in the chat and the
// retry loop stops.
//
//   return chatError("All antigravity accounts are rate-limited, resets in ~5h.");
//   return chatError("Not authenticated, run `cc auth`.", { type: "authentication_error", status: 401 });
export function chatError(message, opts) {
  const { status, body, headers } = JSON.parse(getCoreAuth().chatError(message, JSON.stringify(opts || {})));
  return new Response(body, { status, headers });
}

// Canonical IR<->upstream transport error. The front-door recognizes it by its
// stable `name` marker (duck-typed), never `instanceof`: providers are esbuild-bundled
// independently, so a shared class is never instanceof-compatible across the boundary.
export class HandleIrError extends Error {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  retryAfterMs?: number;
  constructor(init: { status: number; headers?: Record<string, string>; body?: string; retryAfterMs?: number }) {
    super("handleIr transport error: " + init.status);
    this.name = "HandleIrError";
    this.status = init.status;
    this.headers = init.headers;
    this.body = init.body;
    this.retryAfterMs = init.retryAfterMs;
  }
}

export function handleIrErrorFromResponse(res: Response, bodyText: string): HandleIrError {
  const retryAfter = res.headers.get("retry-after");
  return new HandleIrError({
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: bodyText,
    retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : undefined,
  });
}
