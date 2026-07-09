/**
 * Client-side mirror of the `allowed_origins` validation on
 * `AgentSharing` (`apis/ai/stigmer/agentic/agent/v1/spec.proto`).
 *
 * The server enforces these rules via protovalidate CEL; mirroring them
 * here gives immediate feedback in the share dialog instead of a
 * round-trip rejection. The proto is the source of truth — if the CEL
 * expression changes, this module must change with it.
 */

/** Maximum number of allowed origins (proto: `repeated.max_items = 32`). */
export const MAX_ALLOWED_ORIGINS = 32;

/**
 * Exact web origin: scheme://host[:port] — no path, query, fragment, or
 * trailing slash. Mirrors the CEL expression `allowed_origins.format`.
 */
const ORIGIN_PATTERN =
  /^https?:\/\/[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:[0-9]{1,5})?$/;

/**
 * Validate a single origin entry.
 *
 * Returns `null` when valid, or a user-facing message explaining what
 * to fix (DD-006: errors state what happened and what to do).
 */
export function validateOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter an origin, like https://example.com";
  if (!ORIGIN_PATTERN.test(trimmed)) {
    return "Must be an exact web origin like https://example.com — no path, query, or trailing slash";
  }
  return null;
}
