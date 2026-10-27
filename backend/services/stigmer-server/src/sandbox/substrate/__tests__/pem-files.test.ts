/**
 * Pins the PEM files the driver follows (pem-files.ts), over real files
 * holding certificates minted at test time:
 *
 *   - a CA file is parsed, not only searched for a marker: a block whose
 *     body is garbage is a boot throw naming the variable, the path and
 *     the certificate's place in the file, a block cut off before its END
 *     line is refused rather than dropped, and a file with no block still
 *     holds no PEM certificate;
 *   - a bundle of several CAs, as a trust bundle carries across a
 *     rotation, is accepted whole;
 *   - a replaced file is read again, and an unchanged one returns the same
 *     value, so a caller rebuilds only on a change;
 *   - a file that becomes unusable after boot fails the read naming the
 *     variable, and is read again once fixed;
 *   - a credential whose key or chain cannot be parsed is a boot throw.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  mintCa,
  mintServerCertificate,
  type TestCa,
  type TestServerCertificate,
} from "../__test-utils__/test-ca.js";
import { caFromFile, credentialFromFile } from "../pem-files.js";

const CA_VARIABLE = "STIGMER_SANDBOX_SUBSTRATE_API_CA_FILE";
const CREDENTIAL_VARIABLE = "STIGMER_SANDBOX_SUBSTRATE_ROUTER_CLIENT_CERT_FILE";
/** A certificate block a marker check accepts and a parser does not. */
const GARBAGE_CERTIFICATE =
  "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n";
const GARBAGE_KEY =
  "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n";

let oldCa: TestCa;
let newCa: TestCa;
let credential: TestServerCertificate;

beforeAll(async () => {
  oldCa = await mintCa("old test ca");
  newCa = await mintCa("new test ca");
  credential = await mintServerCertificate(oldCa, { dns: ["stigmer-server"] });
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "substrate-pem-files-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function pemFile(contents: string, name = "ca.pem"): string {
  const file = path.join(dir, name);
  writeFileSync(file, contents);
  return file;
}

/** Replaces the file's contents and moves its mtime, as a rotation does. */
function rotate(file: string, contents: string, step: number): void {
  writeFileSync(file, contents);
  const when = new Date(Date.now() + step * 10_000);
  utimesSync(file, when, when);
}

function credentialPem(): string {
  return `${credential.key}\n${credential.cert}\n`;
}

function ca(file: string): () => string {
  return caFromFile(file, CA_VARIABLE, "the Control API's CA");
}

describe("a CA file", () => {
  it("refuses at boot a certificate block whose body is garbage, naming the variable and the certificate", () => {
    const file = pemFile(GARBAGE_CERTIFICATE, "garbage.pem");
    expect(() => ca(file)).toThrow(
      new RegExp(
        `^${CA_VARIABLE} \\(.*garbage\\.pem\\) cannot be used as the Control API's CA: certificate 1 of 1 cannot be parsed: `,
      ),
    );
    // A trust bundle's second certificate is parsed on its own.
    const bundle = pemFile(
      `${oldCa.pem}\n${GARBAGE_CERTIFICATE}`,
      "bundle.pem",
    );
    expect(() => ca(bundle)).toThrow(/certificate 2 of 2 cannot be parsed/);
  });

  it("refuses at boot a certificate block cut off before its END line, never dropping it", () => {
    const truncated = pemFile(
      `${oldCa.pem}\n-----BEGIN CERTIFICATE-----\nMIIB\n`,
      "truncated.pem",
    );
    expect(() => ca(truncated)).toThrow(
      /truncated\.pem holds 2 certificate blocks, and 1 of them has no END line/,
    );
    const credential = pemFile(
      `${credentialPem()}-----BEGIN CERTIFICATE-----\nMIIB\n`,
      "credential.pem",
    );
    expect(() => credentialFromFile(credential, CREDENTIAL_VARIABLE)).toThrow(
      /credential\.pem holds 2 certificate blocks, and 1 of them has no END line/,
    );
  });

  it("refuses at boot a file with no certificate block, and a missing file", () => {
    expect(() => ca(pemFile("not a certificate", "junk.pem"))).toThrow(
      /junk\.pem holds no PEM certificate/,
    );
    expect(() => ca(path.join(dir, "missing.pem"))).toThrow(
      new RegExp(
        `^${CA_VARIABLE} \\(.*missing\\.pem\\) cannot be used .*ENOENT`,
      ),
    );
  });

  it("accepts a bundle of several CAs whole", () => {
    const read = ca(pemFile(`${oldCa.pem}\n${newCa.pem}`));
    expect(read()).toBe(`${oldCa.pem}\n${newCa.pem}\n`);
  });

  it("is read again when replaced, and returns the same value while unchanged", () => {
    const file = pemFile(oldCa.pem);
    const read = ca(file);
    const first = read();
    expect(read()).toBe(first);
    rotate(file, newCa.pem, 1);
    expect(read()).toBe(`${newCa.pem}\n`);
  });

  it("fails a read naming the variable once it becomes unusable, and is read again once fixed", () => {
    const file = pemFile(oldCa.pem);
    const read = ca(file);
    rotate(file, GARBAGE_CERTIFICATE, 1);
    expect(read).toThrow(
      new RegExp(
        `^${CA_VARIABLE} \\(.*\\) cannot be used as the Control API's CA: certificate 1 of 1`,
      ),
    );
    rmSync(file);
    expect(read).toThrow(/ENOENT/);
    rotate(file, newCa.pem, 2);
    expect(read()).toBe(`${newCa.pem}\n`);
  });
});

describe("a client credential file", () => {
  it("is read as its key and its chain, the same object until it changes", () => {
    const file = pemFile(
      `${credential.key}\n${credential.cert}\n`,
      "bundle.pem",
    );
    const read = credentialFromFile(file, CREDENTIAL_VARIABLE);
    const first = read();
    expect(first.key).toBe(credential.key);
    expect(first.cert).toBe(`${credential.cert}\n`);
    expect(read()).toBe(first);
    rotate(file, `${credential.key}\n${credential.cert}\n${oldCa.pem}\n`, 1);
    expect(read()).not.toBe(first);
    expect(read().cert).toBe(`${credential.cert}\n${oldCa.pem}\n`);
  });

  it("refuses at boot a key or a chain that cannot be parsed, naming the variable", () => {
    const prefix = `^${CREDENTIAL_VARIABLE} \\(.*bundle\\.pem\\) cannot be used as the router's client certificate: `;
    expect(() =>
      credentialFromFile(
        pemFile(`${GARBAGE_KEY}${credential.cert}\n`, "bundle.pem"),
        CREDENTIAL_VARIABLE,
      ),
    ).toThrow(new RegExp(`${prefix}its private key cannot be parsed: `));
    expect(() =>
      credentialFromFile(
        pemFile(`${credential.key}\n${GARBAGE_CERTIFICATE}`, "bundle.pem"),
        CREDENTIAL_VARIABLE,
      ),
    ).toThrow(new RegExp(`${prefix}certificate 1 of 1 cannot be parsed: `));
  });
});
