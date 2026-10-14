/**
 * The issuer normalization, rule by rule: each row is a spelling a real
 * OIDC provider produces (or an operator types) and the canonical form it
 * must answer. The table is where a divergence from RFC 3986's
 * syntax-based normalization would surface first, because the function
 * sits on the hot path of every federated login. Hosts are reserved
 * names (RFC 2606); a row's comment names the provider whose spelling it
 * pins.
 */
import { describe, expect, it } from "vitest";

import { normalizeIssuerUrl } from "../issuer-url.js";

describe("normalizeIssuerUrl", () => {
  it.each([
    // The Auth0 shape: the trailing slash its `iss` always carries.
    ["https://tenant.auth0.example/", "https://tenant.auth0.example"],
    ["https://tenant.auth0.example///", "https://tenant.auth0.example"],
    // Okta and Cognito carry a path; the path is preserved.
    ["https://acme.okta.example/oauth2/default", "https://acme.okta.example/oauth2/default"],
    ["https://acme.okta.example/oauth2/default/", "https://acme.okta.example/oauth2/default"],
    [
      "https://cognito-idp.us-east-1.amazonaws.example/us-east-1_AbCdEf",
      "https://cognito-idp.us-east-1.amazonaws.example/us-east-1_AbCdEf",
    ],
    // Scheme and host lowercase; the path keeps its case (RFC 3986 §6.2.2.1).
    ["HTTPS://Tenant.Auth0.EXAMPLE/", "https://tenant.auth0.example"],
    ["https://acme.okta.example/OAuth2/Default", "https://acme.okta.example/OAuth2/Default"],
    // The scheme's default port is dropped; a non-default port survives.
    ["https://sso.example.com:443/", "https://sso.example.com"],
    ["http://sso.example.com:80/", "http://sso.example.com"],
    ["https://sso.example.com:8443/", "https://sso.example.com:8443"],
    ["http://127.0.0.1:57999/", "http://127.0.0.1:57999"],
    // Whitespace is trimmed before anything else.
    ["  https://sso.example.com/  ", "https://sso.example.com"],
    // Already canonical: a fixed point.
    ["https://sso.example.com", "https://sso.example.com"],
  ])("canonicalizes %s → %s", (input, expected) => {
    expect(normalizeIssuerUrl(input)).toBe(expected);
  });

  it("is idempotent on its own output", () => {
    const once = normalizeIssuerUrl("HTTPS://Tenant.Auth0.EXAMPLE:443/path/");
    expect(normalizeIssuerUrl(once)).toBe(once);
  });

  it("answers the trimmed, slash-stripped input when it is not a URL (so its own validation refuses it)", () => {
    expect(normalizeIssuerUrl("")).toBe("");
    expect(normalizeIssuerUrl("   ")).toBe("");
    expect(normalizeIssuerUrl("not a url/")).toBe("not a url");
    expect(normalizeIssuerUrl("sso.example.com")).toBe("sso.example.com");
  });
});
