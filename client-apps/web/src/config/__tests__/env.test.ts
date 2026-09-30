// ---------------------------------------------------------------------------
// env — the accessors every caller reads the deployment from
//
// The API URL and the audience come from the loaded runtime config
// verbatim. The app URL, used to build links other people open (shared
// chats), is the configured one without a trailing slash, or the browser's
// own origin when none is configured, which is right whenever the console
// is served at its public address.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RuntimeConfig } from "../runtime-config";

const runtime = vi.hoisted(() => ({ config: null as RuntimeConfig | null }));
vi.mock("../runtime-config", () => ({
  getRuntimeConfig: () => runtime.config,
}));

import { getApiBaseUrl, getAppBaseUrl, getIamApiAudience } from "../env";

const BASE: RuntimeConfig = {
  apiUrl: "https://api.example.com",
  appUrl: "",
  authMode: "oidc",
  oidcIssuer: "https://issuer.example.com/",
  oidcClientId: "console",
  oidcAudience: "https://api.example.com/",
};

describe("env accessors", () => {
  beforeEach(() => {
    runtime.config = BASE;
  });

  it("reads the API URL and the audience from the runtime config", () => {
    expect(getApiBaseUrl()).toBe("https://api.example.com");
    expect(getIamApiAudience()).toBe("https://api.example.com/");
  });

  it.each([
    ["https://chat.example.com/", "https://chat.example.com"],
    ["https://chat.example.com", "https://chat.example.com"],
  ])(
    "serves the configured app URL %s without its trailing slash",
    (appUrl, expected) => {
      runtime.config = { ...BASE, appUrl };
      expect(getAppBaseUrl()).toBe(expected);
    },
  );

  it("falls back to the browser's own origin when no app URL is configured", () => {
    expect(getAppBaseUrl()).toBe(window.location.origin);
  });
});
