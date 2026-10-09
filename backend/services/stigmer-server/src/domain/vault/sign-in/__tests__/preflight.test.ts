/**
 * Pins the authorize pre-flight probe against Go oauth/preflight.go
 * (stigmer/stigmer#235): ONLY HTTP 400 classifies as blocked (RFC 6749
 * §4.1.2.1's no-redirect rejection); 2xx/3xx/403/503 fail open (bot walls
 * answer server-side GETs while real browsers pass); redirects are never
 * followed; vendor detail comes from an RFC-shaped JSON body only.
 */
import { describe, expect, it } from "vitest";

import { preflightAuthorize } from "../preflight.js";

describe("preflightAuthorize", () => {
  it("classifies HTTP 400 with an RFC-shaped body as a rejection with vendor detail", async () => {
    const rejection = await preflightAuthorize(
      "https://auth.example.com/authorize?x=1",
      async () =>
        new Response(
          JSON.stringify({
            error: "invalid_request",
            error_description: "redirect_uri not allowed",
          }),
          { status: 400 },
        ),
    );
    expect(rejection).toBeDefined();
    expect(rejection?.statusCode).toBe(400);
    expect(rejection?.vendorDetail).toBe("redirect_uri not allowed");
  });

  it("falls back to the RFC error field when error_description is absent", async () => {
    const rejection = await preflightAuthorize(
      "https://auth.example.com/authorize",
      async () =>
        new Response(JSON.stringify({ error: "invalid_request" }), {
          status: 400,
        }),
    );
    expect(rejection?.vendorDetail).toBe("invalid_request");
  });

  it("yields empty vendor detail for an HTML error page (the Canva case) but keeps the snippet", async () => {
    const rejection = await preflightAuthorize(
      "https://auth.example.com/authorize",
      async () => new Response("<html>Nope</html>", { status: 400 }),
    );
    expect(rejection?.vendorDetail).toBe("");
    expect(rejection?.bodySnippet).toBe("<html>Nope</html>");
  });

  const failOpen: Array<[number]> = [[200], [302], [403], [503]];
  it.each(failOpen)("fails open on HTTP %d", async (status) => {
    const rejection = await preflightAuthorize(
      "https://auth.example.com/authorize",
      async () => new Response("whatever", { status }),
    );
    expect(rejection).toBeUndefined();
  });

  it("requests with redirect: manual — the first response alone classifies", async () => {
    let redirectMode = "";
    await preflightAuthorize("https://auth.example.com/authorize", async (_url, init) => {
      redirectMode = init?.redirect ?? "";
      return new Response("", { status: 302 });
    });
    expect(redirectMode).toBe("manual");
  });

  it("propagates network errors to the caller (Go's (nil, err) fail-open diagnostics)", async () => {
    await expect(
      preflightAuthorize("https://auth.example.com/authorize", async () => {
        throw new Error("ETIMEDOUT");
      }),
    ).rejects.toThrow("ETIMEDOUT");
  });
});
