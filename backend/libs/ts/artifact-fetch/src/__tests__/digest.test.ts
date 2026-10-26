/**
 * Pins how a publisher's stated digest is read (`digest.ts`): a release's
 * `sha256sum` line by filename, npm's SRI string to its strongest supported
 * digest, SHA-1 refused (an integrity this library cannot check is not a
 * pin), and each form written back as its publisher writes it, which is what
 * a mismatch error shows a person.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { formatDigest, parseIntegrity, parseShasum, sha256Digest, sha256Hex } from "../digest.js";

describe("parseShasum", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);

  it("returns the digest on the line naming the file, wherever it is, without the binary-mode marker", () => {
    expect(parseShasum(`${A}  first.tar.gz\n${B.toUpperCase()} *second.tar.gz\n`, "second.tar.gz")).toBe(B);
    expect(parseShasum(`\nnot-a-digest\n${A}  first.tar.gz\n`, "first.tar.gz")).toBe(A);
  });

  it("returns an empty string when no line names the file", () => {
    expect(parseShasum(`${A}  first.tar.gz\n`, "missing.tar.gz")).toBe("");
  });
});

describe("parseIntegrity", () => {
  const bytes = Buffer.from("a package");
  const sha512 = createHash("sha512").update(bytes).digest();
  const sha256 = createHash("sha256").update(bytes).digest();

  it("reads npm's sha512 SRI string", () => {
    const parsed = parseIntegrity(`sha512-${sha512.toString("base64")}`);
    expect(parsed.algorithm).toBe("sha512");
    expect(parsed.digest.equals(sha512)).toBe(true);
  });

  it("takes the strongest of several, skipping SHA-1 and unknown tokens", () => {
    const sri = `sha1-${createHash("sha1").update(bytes).digest("base64")} md5-x sha256-${sha256.toString("base64")} sha512-${sha512.toString("base64")}`;
    expect(parseIntegrity(sri).algorithm).toBe("sha512");
    expect(parseIntegrity(`sha256-${sha256.toString("base64")}?opt`).digest.equals(sha256)).toBe(true);
  });

  it("refuses an integrity that names no supported digest", () => {
    expect(() => parseIntegrity(`sha1-${createHash("sha1").update(bytes).digest("base64")}`)).toThrow(/names no sha256, sha384 or sha512 digest/);
    expect(() => parseIntegrity("")).toThrow(/names no/);
    expect(() => parseIntegrity("sha512-")).toThrow(/names no/);
  });
});

describe("formatDigest and sha256Digest", () => {
  it("writes sha256 as hex and the others as SRI, round-tripping both", () => {
    const hex = sha256Hex(Buffer.from("x"));
    expect(formatDigest(sha256Digest(hex))).toBe(hex);
    const sri = `sha512-${createHash("sha512").update("x").digest("base64")}`;
    expect(formatDigest(parseIntegrity(sri))).toBe(sri);
  });
});
