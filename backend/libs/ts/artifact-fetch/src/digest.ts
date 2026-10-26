/**
 * The digests an artifact is checked against before a byte of it is used.
 *
 * Two publishers, two forms, one comparison: a release's `sha256sum`-format
 * checksum file (Temporal's `checksums.txt`) records lowercase sha256 hex per
 * asset, and npm records a package tarball's Subresource Integrity string
 * (`sha512-<base64>`) in the registry and in every lockfile. Both parse to an
 * {@link ExpectedDigest}, the algorithm and the raw digest bytes, so a
 * download is hashed once while it streams and compared by bytes.
 */

import { createHash } from "node:crypto";

/** The hash algorithms an expected digest may name; SHA-1, which old npm lockfiles carry, is refused. */
export type DigestAlgorithm = "sha256" | "sha384" | "sha512";

/** What an artifact's bytes must hash to. */
export interface ExpectedDigest {
  readonly algorithm: DigestAlgorithm;
  readonly digest: Buffer;
}

/** Lowercase hex sha256 of `bytes`. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The sha256 a `shasum`/`sha256sum`-format file records for `filename`, lowercase
 * hex, or "" when the file has no entry for it. Each line is "<hex>  <filename>";
 * `sha256sum -b` writes the filename with a leading "*" (binary mode), which is
 * not part of the name. A release-wide file lists every asset, so the match is
 * by filename, never by position.
 */
export function parseShasum(content: string, filename: string): string {
  for (const line of content.split("\n")) {
    const [hex, name] = line.trim().split(/\s+/, 2);
    if (hex === undefined || name === undefined) continue;
    if (name.replace(/^\*/, "") === filename) return hex.toLowerCase();
  }
  return "";
}

const STRENGTH: Record<DigestAlgorithm, number> = { sha256: 1, sha384: 2, sha512: 3 };

/**
 * The strongest digest an SRI string names (`sha512-<base64>`, possibly several
 * space-separated, as the W3C form allows). Throws when it names none this
 * library accepts: an integrity it cannot check is not a pin.
 */
export function parseIntegrity(sri: string): ExpectedDigest {
  let best: ExpectedDigest | undefined;
  for (const token of sri.trim().split(/\s+/)) {
    const dash = token.indexOf("-");
    if (dash <= 0) continue;
    const algorithm = token.slice(0, dash);
    if (!(algorithm in STRENGTH)) continue;
    const digest = Buffer.from(token.slice(dash + 1).replace(/\?.*$/, ""), "base64");
    const candidate = { algorithm: algorithm as DigestAlgorithm, digest };
    if (digest.length > 0 && (best === undefined || STRENGTH[candidate.algorithm] > STRENGTH[best.algorithm])) best = candidate;
  }
  if (best === undefined) throw new Error(`integrity "${sri}" names no sha256, sha384 or sha512 digest`);
  return best;
}

/** The expected digest a sha256 hex string (a checksum file's line) names. */
export function sha256Digest(hex: string): ExpectedDigest {
  return { algorithm: "sha256", digest: Buffer.from(hex, "hex") };
}

/** A digest as its publisher writes it: hex for sha256, SRI for the others. */
export function formatDigest(expected: ExpectedDigest): string {
  return expected.algorithm === "sha256" ? expected.digest.toString("hex") : `${expected.algorithm}-${expected.digest.toString("base64")}`;
}
