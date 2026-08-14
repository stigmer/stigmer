/**
 * Harness-agnostic sanitization of tool arguments for the `args_preview` field.
 *
 * `args_preview` is the human-readable, UI-facing projection of a tool call's
 * arguments. It is surfaced on the approval card, the CLI, and the web console,
 * and — for the Cursor harness — it is the field a resumed turn parses to rebuild
 * an approval grant's salient identity. So it must always be SMALL and VALID
 * JSON: the per-tool offload does not touch it, and the aggregate size backstop
 * would replace an oversized preview with an unparseable marker.
 *
 * This module is the single home for arg sanitization shared by both harnesses
 * (native re-exports {@link sanitizeArgsPreview} from its status builders; the
 * Cursor gate path uses {@link buildElidedArgsPreview}).
 */

/**
 * Argument keys whose values are secrets and must never appear in a preview.
 * Matched case-insensitively against the top-level key name.
 */
export const SENSITIVE_ARG_KEYS: ReadonlySet<string> = new Set([
  "password", "token", "secret", "api_key", "apikey",
  "credentials", "auth", "authorization",
]);

/** Whole-preview length cap for {@link sanitizeArgsPreview} (native). */
export const MAX_ARGS_PREVIEW_LENGTH = 500;

/**
 * Sanitize args into a compact preview string (native harness behavior).
 *
 * Redacts sensitive keys, then truncates the whole JSON to a fixed length. The
 * truncation can yield invalid JSON, which is acceptable for the native harness
 * (its resume model keys on `tool_call_id`, never on a re-parsed preview). The
 * Cursor gate path must instead use {@link buildElidedArgsPreview}, which keeps
 * the JSON valid and preserves the salient identity fields.
 */
/**
 * Redact secret-keyed values (see {@link SENSITIVE_ARG_KEYS}), preserving every
 * other entry verbatim. The shared first step of both preview builders, and the
 * shape stamped as `args` on interrupt-placeholder tool calls (issue #754's
 * header fix): full enough for the UI's path/primary-arg extraction, never
 * carrying a secret value.
 */
export function redactSensitiveArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    redacted[key] = SENSITIVE_ARG_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : value;
  }
  return redacted;
}

export function sanitizeArgsPreview(args: Record<string, unknown>): string {
  const sanitized = redactSensitiveArgs(args);
  try {
    const json = JSON.stringify(sanitized);
    return json.length > MAX_ARGS_PREVIEW_LENGTH
      ? json.slice(0, MAX_ARGS_PREVIEW_LENGTH) + "…"
      : json;
  } catch {
    return "";
  }
}

/** Per-string-value cap for {@link buildElidedArgsPreview}. */
const MAX_PREVIEW_VALUE_LENGTH = 200;

/**
 * Build a compact, ALWAYS-VALID `args_preview` from a tool call's full,
 * authoritative arguments.
 *
 * Unlike {@link sanitizeArgsPreview} (which truncates the whole string, possibly
 * to invalid JSON), this elides oversized string *values* in place — preserving
 * every key and the JSON structure. Two invariants make it safe for the Cursor
 * gate path:
 *  - It NEVER elides a salient field (the resume grant's identity — the file
 *    path or shell command — is parsed back out of this preview, so it must
 *    survive verbatim).
 *  - It redacts secret keys.
 *
 * The heavy content (a whole-file body, a large diff) lives on `file_changes`
 * (offloaded to a ref when large) and `args` (bounded by the size backstop), so
 * the preview itself stays small even for a multi-MB write.
 *
 * @param args the full tool arguments
 * @param salientFields keys whose values must be preserved verbatim (identity)
 */
export function buildElidedArgsPreview(
  args: Record<string, unknown>,
  salientFields: readonly string[],
): string {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_ARG_KEYS.has(key.toLowerCase())) {
      out[key] = "[REDACTED]";
    } else if (
      !salientFields.includes(key) &&
      typeof value === "string" &&
      value.length > MAX_PREVIEW_VALUE_LENGTH
    ) {
      out[key] = `[${value.length} chars]`;
    } else {
      out[key] = value;
    }
  }
  try {
    return JSON.stringify(out);
  } catch {
    return "";
  }
}
