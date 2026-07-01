/**
 * Unit tests for the DD-E secret-safety gate. These pin the block-vs-capture
 * decision that keeps secret bytes out of durable CAS storage; the same corpus
 * intent will be mirrored cross-edition.
 */

import { describe, expect, it } from "vitest";
import { isSecretLikePath, partitionIgnoredPathsBySecret } from "../secret-paths.js";

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

describe("partitionIgnoredPathsBySecret", () => {
  it("captures ordinary ignored paths and withholds secret-like ones", () => {
    const { capturablePaths, unreviewablePaths } = partitionIgnoredPathsBySecret(
      ["cache/data.json", ".env", "dist/app.js", "server.key"],
      new Set(),
    );
    expect(capturablePaths).toEqual(["cache/data.json", "dist/app.js"]);
    expect(unreviewablePaths).toEqual([".env", "server.key"]);
  });

  it("withholds a secret observed with an EMPTY gate set (global-bypass backstop)", () => {
    // Under spec.auto_approve_all the approval gate is never installed, so the
    // blocked set is empty and this re-check is the ONLY thing keeping a secret's
    // bytes out of durable CAS storage. This is the load-bearing case.
    const { capturablePaths, unreviewablePaths } = partitionIgnoredPathsBySecret(
      [".env"],
      new Set(),
    );
    expect(capturablePaths).toEqual([]);
    expect(unreviewablePaths).toEqual([".env"]);
  });

  it("unions the gate's blocks with observed secrets, gate blocks first, deduped", () => {
    // The gate blocked `.aws/credentials` up front (it never reached the
    // observer); `.env` was observed and re-caught here; `id_rsa` is both.
    const { capturablePaths, unreviewablePaths } = partitionIgnoredPathsBySecret(
      [".env", "cache/x", "id_rsa"],
      new Set([".aws/credentials", "id_rsa"]),
    );
    expect(capturablePaths).toEqual(["cache/x"]);
    // Gate blocks first (set insertion order), then observed secrets not already present.
    expect(unreviewablePaths).toEqual([".aws/credentials", "id_rsa", ".env"]);
  });

  it("returns empty partitions for an empty turn", () => {
    const { capturablePaths, unreviewablePaths } = partitionIgnoredPathsBySecret(
      [],
      new Set(),
    );
    expect(capturablePaths).toEqual([]);
    expect(unreviewablePaths).toEqual([]);
  });

  it("preserves observed order for capturable paths", () => {
    const { capturablePaths } = partitionIgnoredPathsBySecret(
      ["cache/b.txt", "cache/a.txt", "logs/c.log"],
      new Set(),
    );
    expect(capturablePaths).toEqual(["cache/b.txt", "cache/a.txt", "logs/c.log"]);
  });
});
