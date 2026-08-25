import { describe, it, expect } from "vitest";
import { chatError, HandleIrError, handleIrErrorFromResponse } from "./errors.js";

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

describe("chatError", () => {
  it("defaults to a terminal Anthropic-shaped bad request", async () => {
    const response = chatError("all spent");
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-hub-chat-error")).toBe("1");
    expect(await response.json()).toEqual({
      type: "error",
      error: { type: "invalid_request_error", message: "all spent" },
    });
  });

  it("carries the caller's status and error type", async () => {
    const response = chatError("run cc auth", { type: "authentication_error", status: 401 });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      type: "error",
      error: { type: "authentication_error", message: "run cc auth" },
    });
  });

  it("emits the Gemini shape for a provider on that path", async () => {
    const response = chatError("slow down", { format: "gemini", status: 429 });
    expect(await response.json()).toEqual({
      error: { code: 429, message: "slow down", status: "RESOURCE_EXHAUSTED" },
    });
  });

  it("marks rate-limit exhaustion and carries the reset", () => {
    const response = chatError("wait", { rateLimited: true, retryAfterMs: 1500.6 });
    expect(response.headers.get("x-hub-rate-limited")).toBe("1");
    expect(response.headers.get("x-hub-retry-after-ms")).toBe("1501");
  });

  it("omits a reset that has already passed", () => {
    const response = chatError("wait", { rateLimited: true, retryAfterMs: 0 });
    expect(response.headers.get("x-hub-retry-after-ms")).toBeNull();
  });
});
