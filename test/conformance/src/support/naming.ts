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

// The 26 characters after the prefix in every id the server mints (a
// lowercased ULID): 13 random bytes as hex give exactly 26, and every hex
// digit is in the lowercase Crockford alphabet those ids use.
const ID_BODY_BYTES = 13;

// An id a caller might choose for a resource of the kind whose prefix is
// given: the kind's own shape (`{prefix}_` + 26 lowercase Crockford
// characters), unique per call. A test that sends it proves a plausible id
// is refused, not only a malformed one.
export function foreignId(prefix: string): string {
  return `${prefix}_${randomBytes(ID_BODY_BYTES).toString("hex")}`;
}
