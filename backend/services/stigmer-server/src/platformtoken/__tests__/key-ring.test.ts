/**
 * Pins the platform-token key ring:
 *   - a composition's ring from PEM refuses at build time what would fail
 *     quietly later: no public key, a non-RSA or undersized key, a private
 *     key whose public half no verification key matches, a bad TTL; a ring
 *     without a private key verifies and never signs;
 *   - open source's ring rides the key-manager ladder under its rules: the
 *     env key wins, an unusable env key is a throw, a generated key is
 *     persisted 0600 and reused, a file the codec refuses is replaced;
 *   - the four arms of resolvePlatformTokenKeys: no posture, a supplied
 *     ring, open source's own, and the refusal for any other edition.
 */
import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import {
  PLATFORM_TOKEN_KEY_ENV_VAR,
  PLATFORM_TOKEN_KEY_FILE_NAME,
  canSign,
  openSourcePlatformTokenKeyRing,
  platformTokenKeyRingFromPem,
  resolvePlatformTokenKeys,
} from "../key-ring.js";
import { signPlatformToken, verifyPlatformToken } from "../envelope.js";

function rsaPem(bits = 2048): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: bits,
  });
  return {
    privateKeyPem: privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

const pair = rsaPem();
const homes: string[] = [];

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "platform-token-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

describe("platformTokenKeyRingFromPem", () => {
  it("builds a signing ring whose tokens verify, and a verify-only ring without a private key", () => {
    const ring = platformTokenKeyRingFromPem({
      privateKeyPem: pair.privateKeyPem,
      publicKeyPems: [pair.publicKeyPem],
    });
    expect(canSign(ring)).toBe(true);
    if (!canSign(ring)) return;
    const token = signPlatformToken(ring, { sub: "ida_1" }).token;

    const verifyOnly = platformTokenKeyRingFromPem({
      publicKeyPems: [pair.publicKeyPem],
    });
    expect(canSign(verifyOnly)).toBe(false);
    expect(verifyPlatformToken(verifyOnly, token).outcome).toBe("verified");
  });

  it("refuses an empty verification set, a non-RSA key, an undersized key and a bad TTL", () => {
    expect(() => platformTokenKeyRingFromPem({ publicKeyPems: [] })).toThrow(
      /at least one public key/,
    );

    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" })
      .publicKey.export({ format: "pem", type: "spki" })
      .toString();
    expect(() => platformTokenKeyRingFromPem({ publicKeyPems: [ec] })).toThrow(
      /must be an RSA key/,
    );

    const small = rsaPem(1024);
    expect(() =>
      platformTokenKeyRingFromPem({ publicKeyPems: [small.publicKeyPem] }),
    ).toThrow(/at least 2048 bits/);

    expect(() =>
      platformTokenKeyRingFromPem({
        publicKeyPems: [pair.publicKeyPem],
        ttlSeconds: 0,
      }),
    ).toThrow(/positive integer/);
  });

  it("refuses a private key whose public half is not among the verification keys", () => {
    expect(() =>
      platformTokenKeyRingFromPem({
        privateKeyPem: pair.privateKeyPem,
        publicKeyPems: [rsaPem().publicKeyPem],
      }),
    ).toThrow(/would verify nowhere/);
  });
});

describe("openSourcePlatformTokenKeyRing (the key-manager ladder)", () => {
  it("uses the env key when set, and refuses an env value that is not an RSA private key", () => {
    const env = {
      [PLATFORM_TOKEN_KEY_ENV_VAR]: Buffer.from(pair.privateKeyPem).toString(
        "base64",
      ),
    };
    const ring = openSourcePlatformTokenKeyRing({ env, homeDir: tempHome() });
    const token = signPlatformToken(ring, { sub: "ida_1" }).token;
    const expected = platformTokenKeyRingFromPem({
      publicKeyPems: [pair.publicKeyPem],
    });
    expect(verifyPlatformToken(expected, token).outcome).toBe("verified");

    expect(() =>
      openSourcePlatformTokenKeyRing({
        env: {
          [PLATFORM_TOKEN_KEY_ENV_VAR]:
            Buffer.from("not a key").toString("base64"),
        },
        homeDir: tempHome(),
      }),
    ).toThrow(PLATFORM_TOKEN_KEY_ENV_VAR);
  });

  it("generates a key once, persists it 0600, and signs with the same key on the next boot", () => {
    const home = tempHome();
    const first = openSourcePlatformTokenKeyRing({ env: {}, homeDir: home });
    const file = path.join(home, ".stigmer", PLATFORM_TOKEN_KEY_FILE_NAME);
    expect(fs.existsSync(file)).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    }
    const second = openSourcePlatformTokenKeyRing({ env: {}, homeDir: home });
    expect(second.signer.kid).toBe(first.signer.kid);
    const token = signPlatformToken(first, { sub: "ida_1" }).token;
    expect(verifyPlatformToken(second, token).outcome).toBe("verified");
  });

  it("replaces a key file the codec does not accept, as the ladder does for every key", () => {
    const home = tempHome();
    const file = path.join(home, ".stigmer", PLATFORM_TOKEN_KEY_FILE_NAME);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, "garbage", { mode: 0o600 });
    const ring = openSourcePlatformTokenKeyRing({ env: {}, homeDir: home });
    expect(ring.signer.key.asymmetricKeyType).toBe("rsa");
    expect(fs.readFileSync(file, "utf8")).toContain("BEGIN PRIVATE KEY");
  });
});

describe("resolvePlatformTokenKeys", () => {
  const supplied = platformTokenKeyRingFromPem({
    publicKeyPems: [pair.publicKeyPem],
  });

  it("composes no ring without an authentication posture, whatever is supplied", () => {
    expect(
      resolvePlatformTokenKeys({
        requireAuthentication: false,
        supplied,
        edition: ServerEdition.cloud,
      }),
    ).toBeUndefined();
  });

  it("uses a supplied ring under the posture", () => {
    expect(
      resolvePlatformTokenKeys({
        requireAuthentication: true,
        supplied,
        edition: ServerEdition.cloud,
      }),
    ).toBe(supplied);
  });

  it("composes open source's own ring when open source supplies none", () => {
    const ring = resolvePlatformTokenKeys({
      requireAuthentication: true,
      supplied: undefined,
      edition: ServerEdition.oss,
      options: { env: {}, homeDir: tempHome() },
    });
    expect(ring !== undefined && canSign(ring)).toBe(true);
  });

  it("refuses to boot any other edition that supplies no ring", () => {
    expect(() =>
      resolvePlatformTokenKeys({
        requireAuthentication: true,
        supplied: undefined,
        edition: ServerEdition.cloud,
      }),
    ).toThrow(/registers no platform-token key ring/);
  });
});
