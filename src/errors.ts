import { getCoreAuth } from "./core-auth-loader.js";

/** Options to {@link chatError}. */
export interface ChatErrorOptions {
  /** Which app-wire error shape to encode as, e.g. `"anthropic"`. */
  format?: string;
  /** HTTP status; defaults to a non-retried status for the chosen `format`. */
  status?: number;
  /** The wire error's `type` field, e.g. `"authentication_error"`. */
  type?: string;
  /** Gemini-specific status string, when `format` targets Gemini's wire shape. */
  geminiStatus?: string;
  /** Marks the error as rate-limit shaped rather than a hard failure. */
  rateLimited?: boolean;
  /** Milliseconds to wait before retrying. */
  retryAfterMs?: number;
}

/**
 * Builds a Response that surfaces a TERMINAL error into the chat instead of looping forever.
 *
 * @remarks
 * Both hosts retry "transient" upstream statuses (429 rate_limit, 500 api_error, 503, 529
 * overloaded), so returning those for a permanent condition (all accounts spent for hours, auth
 * broken, no accounts) makes the client retry endlessly. An Anthropic 400 invalid_request_error
 * (and 401/403) is instead shown to the user and NOT retried; this returns that shape so
 * `message` appears in the chat and the retry loop stops.
 *
 * @example
 * ```typescript
 * return chatError("All antigravity accounts are rate-limited, resets in ~5h.");
 * return chatError("Not authenticated, run `cc auth`.", { type: "authentication_error", status: 401 });
 * ```
 */
export function chatError(message: string, opts?: ChatErrorOptions): Response {
  const { status, body, headers } = JSON.parse(getCoreAuth().chatError(message, JSON.stringify(opts || {})));
  return new Response(body, { status, headers });
}

/**
 * The canonical IR to upstream transport error a provider's `handleIr` throws on a non-2xx
 * outcome.
 *
 * @remarks The front-door recognizes it by its stable `name` marker (duck-typed), never `instanceof`: providers are esbuild-bundled independently, so a shared class is never instanceof-compatible across the boundary.
 */
export class HandleIrError extends Error {
  /** The upstream HTTP status. */
  status: number;
  /** The upstream response headers. */
  headers?: Record<string, string>;
  /** The upstream response body. */
  body?: string;
  /** Milliseconds to wait before retrying, from the upstream `Retry-After` header. */
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

/** Builds a {@link HandleIrError} from an upstream Response, reading `Retry-After` into `retryAfterMs` when present. */
export function handleIrErrorFromResponse(res: Response, bodyText: string): HandleIrError {
  const retryAfter = res.headers.get("retry-after");
  return new HandleIrError({
    status: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body: bodyText,
    retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : undefined,
  });
}
