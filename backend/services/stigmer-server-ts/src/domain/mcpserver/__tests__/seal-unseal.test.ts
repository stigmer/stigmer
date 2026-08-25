/**
 * Pins the pending-state seal/unseal seams against Go's
 * oauth_connect_secrets_test.go with encryption ENABLED (the composed
 * handshake test runs the disabled/plaintext arm): code_verifier always
 * encrypted at rest, client_secret only when non-empty — NEVER
 * ciphertext-of-empty, so emptiness keeps meaning "public client"
 * (oss#394) — and unseal restores the exact plaintexts. A sealed row on a
 * keyless deployment fails loudly before any token-exchange attempt.
 */
import { describe, expect, it } from "vitest";

import { SecretService } from "../../../encryption/encryption.js";
import { createLogger } from "../../../boot/logger.js";
import type { PendingOAuthState } from "../../../store/interface.js";
import { sealPendingOAuthState } from "../initiate-oauth-connect.js";
import { unsealPendingOAuthState } from "../complete-oauth-connect.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const enabled = SecretService.create(Buffer.alloc(32, 7));
const disabled = SecretService.create(undefined);

function pendingState(overrides?: Partial<PendingOAuthState>): PendingOAuthState {
  return {
    state: "state-1",
    codeVerifier: "verifier-plaintext",
    clientId: "client-1",
    clientSecret: "vendor-secret",
    tokenEndpoint: "https://auth.example.com/token",
    mcpServerId: "mcps_1",
    identityAccountId: "",
    targetEnvVar: "TOKEN",
    authMethod: "vendor_oauth",
    tokenAuthMethod: "client_secret_basic",
    redirectUri: "http://cb",
    org: "acme",
    createdAt: 0,
    ...overrides,
  };
}

describe("sealPendingOAuthState (enabled encryption)", () => {
  it("encrypts the code_verifier and a non-empty client_secret at rest", () => {
    const sealed = sealPendingOAuthState(enabled, silentLogger, pendingState());
    expect(sealed.codeVerifier).toMatch(/^enc:v1:/);
    expect(sealed.clientSecret).toMatch(/^enc:v1:/);
    // Everything else rides unchanged.
    expect(sealed.tokenEndpoint).toBe("https://auth.example.com/token");
  });

  it("keeps the DCR path's empty client_secret EMPTY — never ciphertext-of-empty (oss#394)", () => {
    const sealed = sealPendingOAuthState(
      enabled,
      silentLogger,
      pendingState({ clientSecret: "", authMethod: "mcp_oauth" }),
    );
    expect(sealed.codeVerifier).toMatch(/^enc:v1:/);
    expect(sealed.clientSecret).toBe("");
  });

  it("passes plaintext through with disabled encryption (the WARN-degrade posture)", () => {
    const sealed = sealPendingOAuthState(disabled, silentLogger, pendingState());
    expect(sealed.codeVerifier).toBe("verifier-plaintext");
    expect(sealed.clientSecret).toBe("vendor-secret");
  });
});

describe("unsealPendingOAuthState", () => {
  it("round-trips the sealed secrets back to their exact plaintexts", () => {
    const sealed = sealPendingOAuthState(enabled, silentLogger, pendingState());
    const unsealed = unsealPendingOAuthState(enabled, sealed);
    expect(unsealed.codeVerifier).toBe("verifier-plaintext");
    expect(unsealed.clientSecret).toBe("vendor-secret");
  });

  it("passes legacy plaintext rows through unchanged (pre-sealing shapes)", () => {
    const unsealed = unsealPendingOAuthState(enabled, pendingState());
    expect(unsealed.codeVerifier).toBe("verifier-plaintext");
    expect(unsealed.clientSecret).toBe("vendor-secret");
  });

  it("fails loudly on a sealed row when the key has vanished (before any token exchange)", () => {
    const sealed = sealPendingOAuthState(enabled, silentLogger, pendingState());
    expect(() => unsealPendingOAuthState(disabled, sealed)).toThrow(
      /^failed to decrypt code_verifier: /,
    );
  });
});
