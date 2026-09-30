// ---------------------------------------------------------------------------
// sso-session — only a well-formed SSO record ever picks the sign-in issuer
//
// The login page writes the SSO issuer and client into sessionStorage before
// it redirects; the callback and every later page load read them back to
// build the UserManager that exchanges and renews the tokens. Whatever reads
// back is trusted to name the issuer, so anything malformed (an edited
// value, a missing field, a record from an older build) must read as "no
// SSO session" and fall back to the default issuer, never as a half-filled
// one.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import {
  clearSsoLoginState,
  clearSsoSession,
  getSsoLoginState,
  getSsoSession,
  isValidSsoState,
  saveSsoLoginState,
  saveSsoSession,
  type SsoState,
} from "../sso-session";

const LOGIN_KEY = "stigmer:sso:login";
const SESSION_KEY = "stigmer:sso:session";

const STATE: SsoState = {
  issuer: "https://sso.example.com/",
  clientId: "sso-client",
  audience: "https://api.example.com/",
  org: "acme",
};

describe("isValidSsoState", () => {
  it("accepts a complete record", () => {
    expect(isValidSsoState(STATE)).toBe(true);
  });

  it("accepts an empty audience, which the issuer may leave to its default", () => {
    expect(isValidSsoState({ ...STATE, audience: "" })).toBe(true);
  });

  it.each([
    ["null", null],
    ["a string", "https://sso.example.com/"],
    ["an array", [STATE]],
    ["a missing issuer", { ...STATE, issuer: undefined }],
    ["an empty issuer", { ...STATE, issuer: "" }],
    ["an empty client", { ...STATE, clientId: "" }],
    ["a numeric client", { ...STATE, clientId: 42 }],
    ["a missing audience", { ...STATE, audience: undefined }],
    ["an empty org", { ...STATE, org: "" }],
  ])("refuses %s", (_label, value) => {
    expect(isValidSsoState(value)).toBe(false);
  });
});

describe("the two SSO records", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round-trips the login record and the session record under their own keys", () => {
    saveSsoLoginState(STATE);
    expect(getSsoLoginState()).toEqual(STATE);
    expect(getSsoSession()).toBeNull();

    saveSsoSession({ ...STATE, org: "other" });
    expect(getSsoSession()).toEqual({ ...STATE, org: "other" });
    expect(getSsoLoginState()).toEqual(STATE);
  });

  it("clears each record without touching the other", () => {
    saveSsoLoginState(STATE);
    saveSsoSession(STATE);

    clearSsoLoginState();
    expect(getSsoLoginState()).toBeNull();
    expect(getSsoSession()).toEqual(STATE);

    clearSsoSession();
    expect(getSsoSession()).toBeNull();
  });

  it.each([
    ["unparseable JSON", "{not json"],
    ["a record missing its client", JSON.stringify({ ...STATE, clientId: "" })],
    ["a JSON string", JSON.stringify("sso")],
  ])("reads %s as no session", (_label, raw) => {
    sessionStorage.setItem(SESSION_KEY, raw);
    sessionStorage.setItem(LOGIN_KEY, raw);

    expect(getSsoSession()).toBeNull();
    expect(getSsoLoginState()).toBeNull();
  });
});
