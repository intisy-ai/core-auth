// @ts-nocheck
// OpenCode native in-process FRONT-DOOR: owns the app<->IR translation so providers stay
// IR-native only. OpenCode speaks the Anthropic wire (opencodeProvider defaults to "anthropic"), so
// this decodes the inbound Anthropic body to canonical IR, calls the provider's IR-native handleIr,
// and encodes the IR result back to the Anthropic wire. The encode step is byte-for-byte the SAME
// translation core-proxy's server.ts front-door performs (encodeIrResult), so the native in-process
// path and the out-of-process opencode-proxy path behave identically.
//
// core-ir is a SIBLING of core-auth in every host (libs/core-ir standalone; provider/core-ir when
// bundled), and `src/` and `dist/` are both one level under the core-auth root, so this one literal
// specifier resolves from source (vitest), the compiled dist, and the provider esbuild bundle alike
// -- the same convention the providers' own driver code already uses to reach core-ir.

import { translators } from "../../core-ir/dist/index.js";

// Duck-typed HandleIrError recognizer. The provider throws its OWN esbuild-inlined copy of
// core-proxy's HandleIrError, so `instanceof` is unreliable across the provider/core-auth bundle
// boundary (the exact cross-bundle problem core-proxy's server.ts front-door hit). Match the stable
// name marker plus the transport shape instead -- identical contract to core-proxy's isHandleIrError.
function isHandleIrError(e) {
  return (
    e != null &&
    typeof e === "object" &&
    e.name === "HandleIrError" &&
    typeof e.status === "number" &&
    typeof e.body === "string"
  );
}

// Encodes a provider handleIr result (IrResponse | IrEventStream) back to an Anthropic wire Response.
// Mirrors core-proxy server.ts encodeIrResult exactly: a non-streaming IrResponse becomes one JSON
// body; an IrEventStream (true streaming) is piped through the translator's stateful SSE encoder to
// bytes. The generic front-door synthesizes only the content-type header (same as the proxy path).
async function encodeIrResult(irResult) {
  if (irResult instanceof ReadableStream) {
    const encodeStream = await translators.anthropic.encodeStream();
    const byteStream = irResult.pipeThrough(encodeStream).pipeThrough(new TextEncoderStream());
    return new Response(byteStream, { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  const wire = await translators.anthropic.encodeResponse(irResult);
  return new Response(wire, { status: 200, headers: { "content-type": "application/json" } });
}

// The native OpenCode front-door: Anthropic wire Request -> IR -> provider.handleIr -> Anthropic wire
// Response. A non-2xx transport outcome is thrown by handleIr as a HandleIrError carrying the verbatim
// status/headers/body, which is reconstructed here (the IR models a message, not an HTTP envelope).
export async function handleOpencodeViaIr(def, request, ctx) {
  const log = (ctx && ctx.log) || (() => {});
  let bodyText;
  try { bodyText = await request.clone().text(); } catch { bodyText = ""; }

  let ir;
  try {
    ir = await translators.anthropic.decodeRequest(bodyText || "{}");
  } catch (error) {
    // A body that will not decode through the IR is a malformed request. A legacy provider that still
    // carries a wire handle() gets it verbatim; an IR-native provider has no wire path, so surface a
    // 400 rather than crash on an undefined call.
    log("IR decode failed: " + error);
    if (typeof def.handle === "function") return def.handle(request, ctx);
    return new Response(
      JSON.stringify({ error: { type: "invalid_request_error", message: "request body is not valid JSON" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }

  try {
    const irResult = await def.handleIr(ir, ctx);
    return await encodeIrResult(irResult);
  } catch (error) {
    if (isHandleIrError(error)) {
      return new Response(error.body, { status: error.status, headers: error.headers || {} });
    }
    throw error;
  }
}
