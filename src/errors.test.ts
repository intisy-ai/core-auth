import { describe, it, expect } from "vitest";
import { HandleIrError, handleIrErrorFromResponse } from "./errors.js";

describe("HandleIrError", () => {
  it("carries status/name/body/retryAfterMs from the init object", () => {
    const e = new HandleIrError({ status: 429, body: "x", retryAfterMs: 5000 });
    expect(e.name).toBe("HandleIrError");
    expect(e.status).toBe(429);
    expect(e.body).toBe("x");
    expect(e.retryAfterMs).toBe(5000);
    expect(e).toBeInstanceOf(Error);
  });
});

describe("handleIrErrorFromResponse", () => {
  it("maps status, headers, body, and retry-after seconds to ms", () => {
    const res = new Response("nope", { status: 503, headers: { "retry-after": "5" } });
    const e = handleIrErrorFromResponse(res, "nope");
    expect(e.status).toBe(503);
    expect(e.body).toBe("nope");
    expect(e.retryAfterMs).toBe(5000);
    expect(e.headers?.["retry-after"]).toBe("5");
  });

  it("leaves retryAfterMs undefined when there is no retry-after header", () => {
    const res = new Response("bad", { status: 400 });
    const e = handleIrErrorFromResponse(res, "bad");
    expect(e.retryAfterMs).toBeUndefined();
  });
});
