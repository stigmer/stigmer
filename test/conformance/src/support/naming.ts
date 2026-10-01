// Unique, slug-safe identifiers for per-test isolation.
// Domain: conformance support.
//
// Tests share a per-file server, so colliding names would cross-contaminate.
// Each helper yields a value that survives the server's slug derivation
// (lowercase, starts with a letter) and is unique per call. `foreignId` is
// the one helper that yields a resource id rather than a name.
import { randomBytes, randomUUID } from "node:crypto";

function shortId(): string {
  return randomUUID().slice(0, 8);
}

export function uniqueOrg(): string {
  return `conf-org-${shortId()}`;
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${shortId()}`;
}

// Crockford base-32, lowercased: the alphabet of every id the server mints.
const CROCKFORD_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const ID_BODY_CHARS = 26;

// An id a caller might choose for a resource of the kind whose prefix is
// given: the kind's own shape (`{prefix}_` + 26 lowercase Crockford
// characters), unique per call. A test that sends it proves a plausible id
// is refused, not only a malformed one.
export function foreignId(prefix: string): string {
  // 256 is a multiple of 32, so the modulo keeps every character equally likely.
  const bytes = randomBytes(ID_BODY_CHARS);
  let body = "";
  for (const byte of bytes)
    body += CROCKFORD_ALPHABET.charAt(byte % CROCKFORD_ALPHABET.length);
  return `${prefix}_${body}`;
}
