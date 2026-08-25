// The OAuth refresh call runs in Java (TokenRefresh) over a JS transport, so these drive
// refreshAccessToken against the REAL TeaVM bundle with only `fetch` mocked: a wrong marshaling of
// the config, of the form body, or of a reported failure fails here. Nothing reaches the network.
import { beforeAll, describe, expect, it } from "vitest";
import { initCoreAuth } from "./core-auth-loader.js";
import { refreshAccessToken, TokenRefreshError } from "./oauth.js";

const OAUTH = { tokenUrl: "https://tokens.example/oauth/token", clientId: "client-1", clientSecret: "secret-1" };

type Call = { url: string; init: RequestInit & { proxy?: string } };

function transportReturning(...responses: Array<Response | Error>): { calls: Call[]; fetchImpl: typeof fetch } {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = (async (input: any, init: any) => {
    calls.push({ url: String(input), init });
    const next = responses[Math.min(index++, responses.length - 1)];
    if (next instanceof Error) throw next;
    return next.clone();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("refreshAccessToken over the Java refresh", () => {
  beforeAll(async () => {
    await initCoreAuth();
  });

  it("posts the form-encoded refresh grant and returns the new token set", async () => {
    const { calls, fetchImpl } = transportReturning(
      json({ access_token: "new-access", expires_in: 1800, refresh_token: "new-refresh" }),
    );
    const before = Date.now();

    const result = await refreshAccessToken("old-refresh", OAUTH, { fetchImpl });

    expect(result.access).toBe("new-access");
    expect(result.refresh).toBe("new-refresh");
    expect(result.expires).toBeGreaterThanOrEqual(before + 1800 * 1000);
    expect(result.expires).toBeLessThanOrEqual(Date.now() + 1800 * 1000);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(OAUTH.tokenUrl);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const body = new URLSearchParams(calls[0].init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-refresh");
    expect(body.get("client_id")).toBe("client-1");
    expect(body.get("client_secret")).toBe("secret-1");
  });

  it("carries the driver's extraParams into the grant", async () => {
    const { calls, fetchImpl } = transportReturning(json({ access_token: "a", expires_in: 60 }));

    await refreshAccessToken("r", { ...OAUTH, extraParams: { audience: "aud-1" } }, { fetchImpl });

    expect(new URLSearchParams(calls[0].init.body as string).get("audience")).toBe("aud-1");
  });

  it("keeps the existing refresh token when the endpoint returns none", async () => {
    const { fetchImpl } = transportReturning(json({ access_token: "a", expires_in: 60 }));

    const result = await refreshAccessToken("keep-me", OAUTH, { fetchImpl });

    expect(result.refresh).toBe("keep-me");
  });

  it("defaults to a one-hour expiry when the endpoint reports no expires_in", async () => {
    const { fetchImpl } = transportReturning(json({ access_token: "a" }));
    const before = Date.now();

    const result = await refreshAccessToken("r", OAUTH, { fetchImpl });

    expect(result.expires).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });

  it("reports an invalid_grant refusal as revoked, which is what disables the account", async () => {
    const { fetchImpl } = transportReturning(
      json({ error: "invalid_grant", error_description: "Token has been revoked." }, 400),
    );

    const error = await refreshAccessToken("r", OAUTH, { fetchImpl }).catch((e) => e);

    expect(error).toBeInstanceOf(TokenRefreshError);
    expect(error.revoked).toBe(true);
    expect(error.status).toBe(400);
    expect(error.message).toContain("Token has been revoked.");
  });

  it("reports any other refusal without revoking, keeping the status and code", async () => {
    const { fetchImpl } = transportReturning(
      json({ error: "invalid_client", error_description: "Unknown client." }, 401),
    );

    const error = await refreshAccessToken("r", OAUTH, { fetchImpl }).catch((e) => e);

    expect(error).toBeInstanceOf(TokenRefreshError);
    expect(error.revoked).toBe(false);
    expect(error.status).toBe(401);
    expect(error.code).toBe("invalid_client");
    expect(error.description).toBe("Unknown client.");
  });

  it("surfaces an unreachable endpoint as a TokenRefreshError rather than the raw transport error", async () => {
    const { fetchImpl } = transportReturning(new Error("fetch failed"));

    const error = await refreshAccessToken("r", OAUTH, { fetchImpl }).catch((e) => e);

    expect(error).toBeInstanceOf(TokenRefreshError);
    expect(error.revoked).toBe(false);
  });

  it("retries directly when the account's proxy cannot connect, so an expired token is not stranded", async () => {
    const { calls, fetchImpl } = transportReturning(
      new Error("unable to connect"),
      json({ access_token: "direct", expires_in: 60 }),
    );

    const result = await refreshAccessToken("r", { ...OAUTH, proxy: "http://127.0.0.1:9" }, { fetchImpl });

    expect(result.access).toBe("direct");
    expect(calls).toHaveLength(2);
    expect(calls[0].init.proxy).toBe("http://127.0.0.1:9");
    expect(calls[1].init.proxy).toBeUndefined();
  });

  it("returns undefined without touching the transport when there is no refresh token", async () => {
    const { calls, fetchImpl } = transportReturning(json({ access_token: "a" }));

    expect(await refreshAccessToken(undefined, OAUTH, { fetchImpl })).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
