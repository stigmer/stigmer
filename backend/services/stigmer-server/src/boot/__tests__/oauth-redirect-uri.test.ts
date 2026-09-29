/**
 * Pins the OAuth redirect-URI posture: a configured value wins, a served
 * console derives the console's callback page on the unified port's public
 * origin when one is named (stigmer#1200) and on localhost at a known port
 * otherwise, and a server with no console, or with neither an origin nor a
 * known port, derives nothing (today's warn and refusal stand).
 */
import { describe, expect, it } from "vitest";

import {
  CONSOLE_OAUTH_CALLBACK_PATH,
  resolveOAuthRedirectUri,
} from "../oauth-redirect-uri.js";

describe("resolveOAuthRedirectUri", () => {
  it("keeps a configured value whatever else is true", () => {
    expect(
      resolveOAuthRedirectUri({
        configured: "https://app.stigmer.test/auth/oauth/callback",
        servesConsole: true,
        publicOrigin: "",
        port: 7777,
      }),
    ).toEqual({
      kind: "configured",
      uri: "https://app.stigmer.test/auth/oauth/callback",
    });
    expect(
      resolveOAuthRedirectUri({
        configured: "https://app.stigmer.test/cb",
        servesConsole: false,
        publicOrigin: "",
        port: 0,
      }),
    ).toEqual({
      kind: "configured",
      uri: "https://app.stigmer.test/cb",
    });
  });

  it("keeps a configured value over a named public origin", () => {
    expect(
      resolveOAuthRedirectUri({
        configured: "https://console.stigmer.test/auth/oauth/callback",
        servesConsole: true,
        publicOrigin: "https://api.stigmer.test",
        port: 7777,
      }),
    ).toEqual({
      kind: "configured",
      uri: "https://console.stigmer.test/auth/oauth/callback",
    });
  });

  it("derives the console's callback page at localhost on the unified port when the console is served", () => {
    expect(
      resolveOAuthRedirectUri({
        configured: "",
        servesConsole: true,
        publicOrigin: "",
        port: 7777,
      }),
    ).toEqual({
      kind: "derived",
      uri: `http://localhost:7777${CONSOLE_OAUTH_CALLBACK_PATH}`,
      from: "loopback",
    });
    expect(CONSOLE_OAUTH_CALLBACK_PATH).toBe("/auth/oauth/callback");
  });

  it("derives the callback on the named public origin rather than localhost", () => {
    expect(
      resolveOAuthRedirectUri({
        configured: "",
        servesConsole: true,
        publicOrigin: "https://stigmer.example.test",
        port: 7234,
      }),
    ).toEqual({
      kind: "derived",
      uri: "https://stigmer.example.test/auth/oauth/callback",
      from: "public-origin",
    });
  });

  it("reads an origin written with a trailing slash as the same origin", () => {
    expect(
      resolveOAuthRedirectUri({
        configured: "",
        servesConsole: true,
        publicOrigin: "https://stigmer.example.test/",
        port: 7234,
      }),
    ).toEqual({
      kind: "derived",
      uri: "https://stigmer.example.test/auth/oauth/callback",
      from: "public-origin",
    });
  });

  it("derives on a named public origin even when the port is not known until listen", () => {
    expect(
      resolveOAuthRedirectUri({
        configured: "",
        servesConsole: true,
        publicOrigin: "https://stigmer.example.test",
        port: 0,
      }),
    ).toEqual({
      kind: "derived",
      uri: "https://stigmer.example.test/auth/oauth/callback",
      from: "public-origin",
    });
  });

  it("derives nothing for a server that serves no console", () => {
    expect(
      resolveOAuthRedirectUri({
        configured: "",
        servesConsole: false,
        publicOrigin: "",
        port: 7777,
      }),
    ).toEqual({
      kind: "absent",
    });
    expect(
      resolveOAuthRedirectUri({
        configured: "",
        servesConsole: false,
        publicOrigin: "https://stigmer.example.test",
        port: 7777,
      }),
    ).toEqual({ kind: "absent" });
  });

  it("derives nothing when neither a public origin is named nor the port known", () => {
    expect(
      resolveOAuthRedirectUri({
        configured: "",
        servesConsole: true,
        publicOrigin: "",
        port: 0,
      }),
    ).toEqual({
      kind: "absent",
    });
  });
});
