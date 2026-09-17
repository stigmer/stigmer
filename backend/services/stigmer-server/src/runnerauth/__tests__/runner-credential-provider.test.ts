/**
 * Pins the OSS RunnerCredentialProvider default (O5, §6c) as behaviorally
 * identical to direct RunnerAuthService use on the execution_scoped lane,
 * and pins the per-arm posture for lanes OSS does not provide: verify
 * fails CLOSED (InvalidTokenError — callers fall back to redaction), mint
 * fails LOUD (a plain Error naming the lane — a composition bug, not a
 * runtime condition), isEnabled answers the honest false.
 *
 * Also pins the one capability the default DEFINES: `mintRunCredential`,
 * the clockless run credential a dispatch carries — minted on the
 * execution_scoped lane with no `exp`, and "" (never a throw) when the
 * service is keyless, so a dispatch degrades instead of failing.
 */
import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { newExecutionScopedRunnerCredentialProvider } from "../runner-credential-provider.js";
import {
  DEFAULT_TTL_SECONDS,
  InvalidTokenError,
  isClockedToken,
  MintingDisabledError,
  RunnerAuthService,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "../runnerauth.js";

const KEY = randomBytes(32);

describe("execution-scoped provider over a keyed service", () => {
  const service = RunnerAuthService.create(KEY);
  const provider = newExecutionScopedRunnerCredentialProvider(service);

  it("mints on the execution_scoped lane exactly as the service does", () => {
    const minted = provider.mint(TOKEN_TYPE_EXECUTION_SCOPED, "aex_prov", 0);
    expect(minted.ttlSeconds).toBe(DEFAULT_TTL_SECONDS);
    // Cross-verification both ways: one key, one token dialect.
    expect(service.verify(minted.token)).toBe("aex_prov");
    expect(provider.verify(TOKEN_TYPE_EXECUTION_SCOPED, minted.token)).toBe(
      "aex_prov",
    );
  });

  it("isEnabled answers per lane: true for execution_scoped, false for anything else", () => {
    expect(provider.isEnabled(TOKEN_TYPE_EXECUTION_SCOPED)).toBe(true);
    expect(provider.isEnabled("session_scoped")).toBe(false);
    expect(provider.isEnabled("")).toBe(false);
  });

  it("mint on an unprovided lane fails loud, naming the lane", () => {
    expect(() => provider.mint("pool_claim", "aex_x", 0)).toThrowError(
      /runner credential lane 'pool_claim' is not provided by this implementation \(provides 'execution_scoped'\)/,
    );
  });

  it("verify on an unprovided lane fails closed to InvalidTokenError", () => {
    const minted = provider.mint(TOKEN_TYPE_EXECUTION_SCOPED, "aex_prov", 0);
    // Even a GENUINE token fails when the caller accepts a different
    // lane — the caller's trust statement governs.
    expect(() => provider.verify("session_scoped", minted.token)).toThrow(
      InvalidTokenError,
    );
  });

  it("verify failures on the provided lane collapse to the one InvalidTokenError", () => {
    expect(() =>
      provider.verify(TOKEN_TYPE_EXECUTION_SCOPED, "not-a-token"),
    ).toThrow(InvalidTokenError);
  });

  it("mintRunCredential mints the clockless run credential, bound to the execution, on the provided lane", () => {
    const token = provider.mintRunCredential!("aex_dispatch");
    expect(token).not.toBe("");
    expect(provider.verify(TOKEN_TYPE_EXECUTION_SCOPED, token)).toBe(
      "aex_dispatch",
    );
    // No `exp`: the credential's validity is the row's liveness, never a
    // clock (the run credential's defining property).
    expect(isClockedToken(token)).toBe(false);
  });

  it("mintRunCredential refuses an empty execution id loudly — a programming error, not a degrade", () => {
    expect(() => provider.mintRunCredential!("")).toThrowError(
      /execution id is required/,
    );
  });
});

describe("execution-scoped provider over a keyless service", () => {
  const provider = newExecutionScopedRunnerCredentialProvider(
    RunnerAuthService.create(undefined),
  );

  it("isEnabled is false even for the provided lane", () => {
    expect(provider.isEnabled(TOKEN_TYPE_EXECUTION_SCOPED)).toBe(false);
  });

  it("mint throws MintingDisabledError — the not-minted response arm", () => {
    expect(() =>
      provider.mint(TOKEN_TYPE_EXECUTION_SCOPED, "aex_keyless", 0),
    ).toThrow(MintingDisabledError);
  });

  it("verify rejects everything — without a key no token can be genuine", () => {
    expect(() =>
      provider.verify(TOKEN_TYPE_EXECUTION_SCOPED, "any-token"),
    ).toThrow(InvalidTokenError);
  });

  it('mintRunCredential answers "" — the dispatch goes without, never fails', () => {
    expect(provider.mintRunCredential!("aex_keyless")).toBe("");
  });
});
