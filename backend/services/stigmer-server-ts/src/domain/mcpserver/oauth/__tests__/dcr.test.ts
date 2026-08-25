/**
 * Pins RFC 7591 Dynamic Client Registration against Go oauth/dcr.go: the
 * public-client request shape (token_endpoint_auth_method "none" — MCP
 * OAuth uses PKCE, and the empty secret keeps meaning "public client",
 * oss#394), 200/201 acceptance, the 256-byte error-body truncation, and
 * the missing-client_id refusal.
 */
import { describe, expect, it } from "vitest";

import { registerClient } from "../dcr.js";

describe("registerClient", () => {
  it("registers a public client with the exact RFC 7591 request shape", async () => {
    let requestBody: Record<string, unknown> = {};
    const response = await registerClient(
      "https://auth.example.com/register",
      "http://127.0.0.1:8234/auth/oauth/callback",
      "Stigmer (Example Server)",
      async (_url, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ client_id: "dcr-client-1", client_name: "Stigmer (Example Server)" }),
          { status: 201 },
        );
      },
    );
    expect(requestBody).toEqual({
      redirect_uris: ["http://127.0.0.1:8234/auth/oauth/callback"],
      client_name: "Stigmer (Example Server)",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    expect(response.clientId).toBe("dcr-client-1");
    expect(response.clientSecret).toBe("");
  });

  it("accepts HTTP 200 as well as 201 (real providers answer both)", async () => {
    const response = await registerClient(
      "https://auth.example.com/register",
      "http://cb",
      "Stigmer (X)",
      async () =>
        new Response(JSON.stringify({ client_id: "ok-200" }), { status: 200 }),
    );
    expect(response.clientId).toBe("ok-200");
  });

  it("refuses a non-2xx with the truncated body (256-byte cap)", async () => {
    const longBody = "x".repeat(300);
    await expect(
      registerClient(
        "https://auth.example.com/register",
        "http://cb",
        "Stigmer (X)",
        async () => new Response(longBody, { status: 400 }),
      ),
    ).rejects.toThrow(
      `DCR at https://auth.example.com/register returned HTTP 400: ${"x".repeat(256)}...`,
    );
  });

  it("refuses a 201 whose body has no client_id", async () => {
    await expect(
      registerClient(
        "https://auth.example.com/register",
        "http://cb",
        "Stigmer (X)",
        async () => new Response(JSON.stringify({}), { status: 201 }),
      ),
    ).rejects.toThrow(
      "DCR response from https://auth.example.com/register is missing client_id",
    );
  });

  it("wraps a network failure with the DCR-request prefix", async () => {
    await expect(
      registerClient(
        "https://auth.example.com/register",
        "http://cb",
        "Stigmer (X)",
        async () => {
          throw new Error("socket hang up");
        },
      ),
    ).rejects.toThrow(
      "DCR request to https://auth.example.com/register failed: socket hang up",
    );
  });
});
