// Unit arm for the mock authorization server's consent-by-redirect lever: with
// `authorizeRedirect` on, a 200 authorize answers as a user who approved would,
// a 302 to the request's redirect_uri carrying a fresh code and the request's
// state, so a browser-driven sign-in completes against the mock; off, the
// static login page the server's pre-flight probe expects stands; `reset()`
// turns it off. Driven over loopback; no target.
// Domain: conformance harness.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MockOAuthAuthorizationServer } from "../oauth-authorization-server";

const mock = new MockOAuthAuthorizationServer();

beforeAll(async () => {
  await mock.start();
});

afterAll(async () => {
  await mock.close();
});

afterEach(() => mock.reset());

describe("authorizeRedirect", () => {
  it("consents by redirect with a fresh code and the request's state, and refuses a request without redirect_uri", async () => {
    mock.authorizeRedirect = true;
    const url = new URL("/authorize", mock.origin());
    url.searchParams.set("redirect_uri", "http://localhost:3000/auth/oauth/callback");
    url.searchParams.set("state", "abc123");
    const answer = await fetch(url, { redirect: "manual" });
    expect(answer.status).toBe(302);
    const location = new URL(answer.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("http://localhost:3000/auth/oauth/callback");
    expect(location.searchParams.get("state")).toBe("abc123");
    expect(location.searchParams.get("code")).toMatch(/^mock-authorization-code-\d+$/);

    const bare = await fetch(new URL("/authorize", mock.origin()), { redirect: "manual" });
    expect(bare.status).toBe(400);
  });

  it("stands as the static login page when the lever is off, which reset() restores", async () => {
    mock.authorizeRedirect = true;
    mock.reset();
    const answer = await fetch(new URL("/authorize?redirect_uri=http://localhost:3000/cb", mock.origin()), { redirect: "manual" });
    expect(answer.status).toBe(200);
    expect(await answer.text()).toContain("Sign in to ConformanceVendor");
  });
});
