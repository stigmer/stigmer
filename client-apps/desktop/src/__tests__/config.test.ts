// ---------------------------------------------------------------------------
// config — the API URL decides whether the app signs in, and what it guesses
//
// The desktop app runs with auth disabled only against a server on this
// machine. Everything else signs in, and so does a build that forces it. A
// URL that is not a usable http(s) URL must fail closed: it turns sign-in on
// (the sign-in screen then names the bad URL), never off. The deployment mode is only a
// guess until the server answers; it is "local" for a local URL, "cloud"
// otherwise.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  fallbackDeploymentMode,
  isAuthDisabled,
  isLocalApiUrl,
  isValidApiUrl,
} from "../config";

describe("isLocalApiUrl", () => {
  it.each([
    ["http://localhost:7234", true],
    ["http://127.0.0.1:7234", true],
    ["https://localhost", true],
    ["https://api.stigmer.ai", false],
    ["http://localhost.example.com", false],
    ["http://127.0.0.2:7234", false],
    ["http://[::1]:7234", false],
    ["localhost:7234", false],
    ["not a url", false],
    ["", false],
  ])("%s is local: %s", (url, local) => {
    expect(isLocalApiUrl(url)).toBe(local);
  });
});

describe("isAuthDisabled", () => {
  it("disables auth against a local server", () => {
    expect(isAuthDisabled("http://localhost:7234", false)).toBe(true);
    expect(isAuthDisabled("http://127.0.0.1:7234", false)).toBe(true);
  });

  it("keeps auth on against any remote server", () => {
    expect(isAuthDisabled("https://api.stigmer.ai", false)).toBe(false);
  });

  it("keeps auth on against a local server when the build forces sign-in", () => {
    expect(isAuthDisabled("http://localhost:7234", true)).toBe(false);
  });

  it.each([
    "not a url",
    "",
    "api.stigmer.ai",
    "api.stigmer.ai:443",
    "localhost:7234",
    "http://",
    "ftp://localhost",
  ])("fails closed on the unparseable URL %j, keeping auth on", (url) => {
    expect(isAuthDisabled(url, false)).toBe(false);
  });
});

describe("isValidApiUrl", () => {
  it.each([
    ["https://api.stigmer.ai", true],
    ["http://localhost:7234", true],
    ["api.stigmer.ai:443", false],
    ["localhost:7234", false],
    ["file:///etc/hosts", false],
    ["not a url", false],
    ["", false],
  ])("%j is valid: %s", (url, valid) => {
    expect(isValidApiUrl(url)).toBe(valid);
  });
});

describe("fallbackDeploymentMode", () => {
  it.each([
    ["http://localhost:7234", "local"],
    ["http://127.0.0.1:7234", "local"],
    ["https://api.stigmer.ai", "cloud"],
    ["https://stigmer.acme.internal", "cloud"],
    ["not a url", "local"],
    ["api.stigmer.ai:443", "local"],
  ])("guesses %s as %s", (url, mode) => {
    expect(fallbackDeploymentMode(url)).toBe(mode);
  });
});
