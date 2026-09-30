// ---------------------------------------------------------------------------
// token-store — where the desktop keeps its session between launches
//
// Today the tokens live in the webview's localStorage under one key (the
// move to the OS keychain is a separate decision). This suite pins that
// behaviour: a saved session loads back as saved, a clear removes it, a
// stored value that does not parse loads as no session, and "expired" means
// within 60 seconds of the expiry, so a token is never sent in its last
// minute.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { clearTokens, isExpired, loadTokens, saveTokens } from "../token-store";

const KEY = "stigmer:auth:tokens";
const NOW = 1_800_000_000_000;

describe("token-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads nothing when nothing is stored", () => {
    expect(loadTokens()).toBeNull();
  });

  it("loads back exactly the session it saved, under its one key", () => {
    const tokens = {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: NOW,
      idToken: "id",
    };
    saveTokens(tokens);

    expect(loadTokens()).toEqual(tokens);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "null")).toEqual(tokens);
  });

  it("clears the stored session", () => {
    saveTokens({ accessToken: "access" });
    clearTokens();
    expect(loadTokens()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("loads a stored value that does not parse as no session", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadTokens()).toBeNull();
  });
});

describe("isExpired", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["with no expiry", undefined, false],
    ["two minutes out", NOW + 120_000, false],
    ["61 seconds out", NOW + 61_000, false],
    ["exactly 60 seconds out", NOW + 60_000, true],
    ["30 seconds out", NOW + 30_000, true],
    ["already past", NOW - 1, true],
  ])("treats a token %s as expired: %s", (_label, expiresAt, expired) => {
    expect(isExpired({ accessToken: "a", expiresAt })).toBe(expired);
  });
});
