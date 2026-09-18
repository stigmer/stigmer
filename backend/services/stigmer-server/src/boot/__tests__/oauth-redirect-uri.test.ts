/**
 * Pins the OAuth redirect-URI posture: a configured value wins, a served
 * console on a known port derives the console's callback page at
 * localhost, and a server with no console or no known port derives nothing
 * (today's warn and refusal stand).
 */
import { describe, expect, it } from "vitest";

import { CONSOLE_OAUTH_CALLBACK_PATH, resolveOAuthRedirectUri } from "../oauth-redirect-uri.js";

describe("resolveOAuthRedirectUri", () => {
  it("keeps a configured value whatever else is true", () => {
    expect(resolveOAuthRedirectUri({ configured: "https://app.stigmer.test/auth/oauth/callback", servesConsole: true, port: 7777 })).toEqual({
      kind: "configured",
      uri: "https://app.stigmer.test/auth/oauth/callback",
    });
    expect(resolveOAuthRedirectUri({ configured: "https://app.stigmer.test/cb", servesConsole: false, port: 0 })).toEqual({
      kind: "configured",
      uri: "https://app.stigmer.test/cb",
    });
  });

  it("derives the console's callback page at localhost on the unified port when the console is served", () => {
    expect(resolveOAuthRedirectUri({ configured: "", servesConsole: true, port: 7777 })).toEqual({
      kind: "derived",
      uri: `http://localhost:7777${CONSOLE_OAUTH_CALLBACK_PATH}`,
    });
    expect(CONSOLE_OAUTH_CALLBACK_PATH).toBe("/auth/oauth/callback");
  });

  it("derives nothing for a server that serves no console", () => {
    expect(resolveOAuthRedirectUri({ configured: "", servesConsole: false, port: 7777 })).toEqual({ kind: "absent" });
  });

  it("derives nothing when the port is not known until listen", () => {
    expect(resolveOAuthRedirectUri({ configured: "", servesConsole: true, port: 0 })).toEqual({ kind: "absent" });
  });
});
