// Unique, slug-safe identifiers for per-test isolation.
// Domain: conformance support.
//
// Tests share a per-file server, so colliding names would cross-contaminate.
// Each helper yields a value that survives the server's slug derivation
// (lowercase, starts with a letter) and is unique per call.
import { randomUUID } from "node:crypto";

function shortId(): string {
  return randomUUID().slice(0, 8);
}

export function uniqueOrg(): string {
  return `conf-org-${shortId()}`;
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${shortId()}`;
}
