import { describe, it, expect } from "vitest";
import { translators } from "../../core-ir/dist/index.js";
import { handleOpencodeViaIr } from "./opencode-ir.js";

const wireRequest = JSON.stringify({
  model: "claude-x",
  max_tokens: 16,
  messages: [{ role: "user", content: "hi" }],
});

function req() {
  return new Request("https://api.anthropic.com/v1/messages", { method: "POST", body: wireRequest });
}

describe("handleOpencodeViaIr (OpenCode native front-door)", () => {
  it("decodes the wire request, calls handleIr, and encodes the IrResponse back to Anthropic wire", async () => {
    // Build a valid IrResponse by decoding a known Anthropic response through the same translator.
    const irResponse = await translators.anthropic.decodeResponse(
      JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: "claude-x",
        content: [{ type: "text", text: "hello" }],
        stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 },
      })
    );
    let seenIr = null;
    const def = {
      handleIr: async (ir: any) => { seenIr = ir; return irResponse; },
      handle: async () => new Response("legacy handle() must not run on the IR path", { status: 500 }),
    };
    const res = await handleOpencodeViaIr(def, req(), { log() {} });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(await res.text());
    expect(body.content[0].text).toBe("hello");
    // The provider saw canonical IR, not the raw wire.
    expect(seenIr).not.toBeNull();
    expect(seenIr.model).toBe("claude-x");
  });

  it("reconstructs a thrown HandleIrError verbatim (status + headers + body), no re-encode", async () => {
    const def = {
      handleIr: async () => {
        throw Object.assign(new Error("upstream 429"), {
          name: "HandleIrError",
          status: 429,
          headers: { "retry-after": "5", "content-type": "application/json" },
          body: JSON.stringify({ type: "error", error: { type: "rate_limit_error" } }),
        });
      },
      handle: async () => new Response("legacy handle() must not run on the IR path", { status: 500 }),
    };
    const res = await handleOpencodeViaIr(def, req(), { log() {} });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("5");
    const body = JSON.parse(await res.text());
    expect(body.error.type).toBe("rate_limit_error");
  });

  it("falls back to legacy handle() when the inbound body cannot be decoded to IR", async () => {
    let legacyCalled = false;
    const def = {
      handleIr: async () => { throw new Error("handleIr must not be reached for an undecodable body"); },
      handle: async () => { legacyCalled = true; return new Response("legacy served", { status: 200 }); },
    };
    const badReq = new Request("https://api.anthropic.com/v1/messages", { method: "POST", body: "<<<not json>>>" });
    const res = await handleOpencodeViaIr(def, badReq, { log() {} });
    expect(legacyCalled).toBe(true);
    expect(await res.text()).toBe("legacy served");
  });
});
