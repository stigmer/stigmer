/**
 * Unit tests for the DD-E secret-safety gate. These pin the block-vs-capture
 * decision that keeps secret bytes out of durable CAS storage; the same corpus
 * intent will be mirrored cross-edition.
 */

import { describe, expect, it } from "vitest";
import { isSecretLikePath } from "../secret-paths.js";

describe("isSecretLikePath — blocks secret-like paths (fail-closed)", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production",
    "config/.env.test",
    "app.pem",
    "server.key",
    "cert.pfx",
    "keystore.p12",
    "id_rsa",
    "nested/dir/id_ed25519",
    "credentials",
    "credentials.json",
    "secrets.yaml",
    "terraform.tfstate",
    "terraform.tfstate.backup",
    "prod.tfvars",
    ".npmrc",
    ".netrc",
    "vault.kdbx",
    ".ssh/known_hosts",
    "home/.aws/credentials",
    ".kube/config",
    ".docker/config.json",
  ])("blocks %s", (path) => {
    expect(isSecretLikePath(path)).toBe(true);
  });

  it("blocks an empty path (fail-closed)", () => {
    expect(isSecretLikePath("")).toBe(true);
  });

  it("matches basenames case-insensitively", () => {
    expect(isSecretLikePath("Server.KEY")).toBe(true);
    expect(isSecretLikePath(".ENV")).toBe(true);
  });

  it("handles Windows-style separators", () => {
    expect(isSecretLikePath("config\\.env.local")).toBe(true);
    expect(isSecretLikePath("home\\.ssh\\id_rsa")).toBe(true);
  });
});

describe("isSecretLikePath — captures ordinary ignored files", () => {
  it.each([
    "dist/bundle.js",
    "build/output.txt",
    "node_modules/left-pad/index.js",
    "coverage/report.html",
    "notes.md",
    "src/main.ts",
    "id_rsa.pub", // a PUBLIC key is not a secret
    "environment.ts", // not a .env file
    "keyboard.tsx", // not a *.key file
    ".envrc.example",
  ])("captures %s", (path) => {
    expect(isSecretLikePath(path)).toBe(false);
  });
});
