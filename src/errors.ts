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
  const type = o.type || "invalid_request_error";
  const status = typeof o.status === "number" ? o.status : 400;
  // The x-hub-chat-error marker lets a provider's Anthropic bridge recognize this as an
  // already-formed terminal error and deliver it as a clean SSE `error` event, instead
  // of translating it as a Gemini chunk or re-wrapping it (which leaks the raw JSON).
  return new Response(
    JSON.stringify({ type: "error", error: { type, message } }),
    { status, headers: { "content-type": "application/json", "x-hub-chat-error": "1" } },
  );
}
