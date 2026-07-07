// @ts-nocheck
// Let a provider surface a TERMINAL error into the chat instead of looping forever.
//
// Both hosts retry "transient" upstream statuses (429 rate_limit, 500 api_error,
// 503, 529 overloaded) — so returning those for a permanent condition (all accounts
// spent for hours, auth broken, no accounts) makes the client retry endlessly. An
// Anthropic 400 invalid_request_error (and 401/403) is instead shown to the user and
// NOT retried. chatError() returns that shape so `message` appears in the chat and the
// retry loop stops.
//
//   return chatError("All antigravity accounts are rate-limited — resets in ~5h.");
//   return chatError("Not authenticated — run `cc auth`.", { type: "authentication_error", status: 401 });
export function chatError(message, opts) {
  const o = opts || {};
  const status = typeof o.status === "number" ? o.status : 400;
  // The error body must match what the host's SDK parses, or it's dumped raw:
  //   - anthropic (@ai-sdk/anthropic, Claude): { type:"error", error:{ type, message } }
  //   - gemini    (@ai-sdk/google):            { error:{ code, message, status } }
  // A provider on the Gemini path (antigravity) passes format:"gemini"; its Claude
  // bridge converts back to the Anthropic shape (recognized via the x-hub-chat-error
  // marker) so both hosts render a clean "…: message" instead of the raw JSON.
  const payload = o.format === "gemini"
    ? { error: { code: status, message, status: o.geminiStatus || (status === 429 ? "RESOURCE_EXHAUSTED" : "INVALID_ARGUMENT") } }
    : { type: "error", error: { type: o.type || "invalid_request_error", message } };
  const headers = { "content-type": "application/json", "x-hub-chat-error": "1" };
  // Mark rate-limit exhaustion so the loader proxy can advance to the next fallback
  // model instead of surfacing this as terminal — and carry the reset so the proxy's
  // final (all-fallbacks-exhausted) message is consistent across providers.
  if (o.rateLimited) {
    headers["x-hub-rate-limited"] = "1";
    if (typeof o.retryAfterMs === "number" && o.retryAfterMs > 0) headers["x-hub-retry-after-ms"] = String(Math.round(o.retryAfterMs));
  }
  return new Response(JSON.stringify(payload), { status, headers });
}
