/**
 * Pins the key ladder (env var → key file → auto-generate), the strict
 * env-key validation (explicit misconfiguration errors, never degrades),
 * the 0600 permission gate on key files, and persistence of auto-generated
 * keys. All tests run against an injected temp home (DD-002) — the real
 * ~/.stigmer is never touched.
 */
import { mkdtempSync, chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  KEY_FILE_PERMISSIONS,
  KEY_SIZE,
  getOrCreateNamedKey,
  namedKeyFilePath,
} from "../key-manager.js";

const ENV_VAR = "STIGMER_TEST_KEY";
const FILE_NAME = "test.key";

const tempHomes: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "stigmer-keymgr-"));
  tempHomes.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempHomes.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("key ladder priority", () => {
  it("prefers a valid env key over an existing key file", () => {
    const homeDir = tempHome();
    const fileKey = Buffer.alloc(KEY_SIZE, 1);
    const keyPath = namedKeyFilePath(FILE_NAME, { homeDir });
    mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    writeFileSync(keyPath, fileKey, { mode: KEY_FILE_PERMISSIONS });

    const envKey = Buffer.alloc(KEY_SIZE, 2);
    const key = getOrCreateNamedKey(ENV_VAR, FILE_NAME, {
      env: { [ENV_VAR]: envKey.toString("base64") },
      homeDir,
    });
    expect(key.equals(envKey)).toBe(true);
  });

  it("loads an existing 0600 key file when no env key is set", () => {
    const homeDir = tempHome();
    const fileKey = Buffer.alloc(KEY_SIZE, 3);
    const keyPath = namedKeyFilePath(FILE_NAME, { homeDir });
    mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    writeFileSync(keyPath, fileKey, { mode: KEY_FILE_PERMISSIONS });

    const key = getOrCreateNamedKey(ENV_VAR, FILE_NAME, { env: {}, homeDir });
    expect(key.equals(fileKey)).toBe(true);
  });

  it("auto-generates and persists (0600) when neither source exists", () => {
    const homeDir = tempHome();
    const key = getOrCreateNamedKey(ENV_VAR, FILE_NAME, { env: {}, homeDir });
    expect(key.length).toBe(KEY_SIZE);

    const keyPath = namedKeyFilePath(FILE_NAME, { homeDir });
    expect(readFileSync(keyPath).equals(key)).toBe(true);
    expect(statSync(keyPath).mode & 0o777).toBe(KEY_FILE_PERMISSIONS);

    // A second load adopts the persisted key (stable across boots).
    const again = getOrCreateNamedKey(ENV_VAR, FILE_NAME, { env: {}, homeDir });
    expect(again.equals(key)).toBe(true);
  });
});

describe("explicit env misconfiguration errors (never degrades)", () => {
  it("rejects invalid Base64", () => {
    expect(() =>
      getOrCreateNamedKey(ENV_VAR, FILE_NAME, {
        env: { [ENV_VAR]: "not!!valid@@base64" },
        homeDir: tempHome(),
      }),
    ).toThrow(`invalid Base64 encoding in ${ENV_VAR}`);
  });

  it("rejects a wrong-length key with the exact byte count", () => {
    expect(() =>
      getOrCreateNamedKey(ENV_VAR, FILE_NAME, {
        env: { [ENV_VAR]: Buffer.alloc(16, 1).toString("base64") },
        homeDir: tempHome(),
      }),
    ).toThrow(
      `${ENV_VAR} must be exactly 32 bytes (256 bits) when decoded, got 16 bytes`,
    );
  });
});

describe("key file load gates (fall through to auto-generate, as Go does)", () => {
  it.skipIf(process.platform === "win32")(
    "never adopts a key file with insecure permissions",
    () => {
      const homeDir = tempHome();
      const insecureKey = Buffer.alloc(KEY_SIZE, 4);
      const keyPath = namedKeyFilePath(FILE_NAME, { homeDir });
      mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
      writeFileSync(keyPath, insecureKey);
      chmodSync(keyPath, 0o644);

      const key = getOrCreateNamedKey(ENV_VAR, FILE_NAME, { env: {}, homeDir });
      expect(key.equals(insecureKey)).toBe(false);
    },
  );

  it("never adopts a wrong-size key file", () => {
    const homeDir = tempHome();
    const keyPath = namedKeyFilePath(FILE_NAME, { homeDir });
    mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    writeFileSync(keyPath, Buffer.alloc(16, 5), { mode: KEY_FILE_PERMISSIONS });

    const key = getOrCreateNamedKey(ENV_VAR, FILE_NAME, { env: {}, homeDir });
    expect(key.length).toBe(KEY_SIZE);
    expect(key.subarray(0, 16).equals(Buffer.alloc(16, 5))).toBe(false);
  });
});
