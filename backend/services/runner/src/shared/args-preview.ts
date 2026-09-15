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
 * ONE preview rule for every row (S4 M2 C7, Q-S4-16): the transcript builder
 * stamps every tool row's preview through {@link buildElidedArgsPreview} over
 * {@link SALIENT_ARG_FIELDS}, as `message.proto` promises — sanitized,
 * redacted, at creation, for inline visibility. Until C7 there were two
 * rules: native stamped a whole-string-truncating `sanitizeArgsPreview` on
 * gated rows only (a preview that could truncate to invalid JSON, acceptable
 * only because native's resume never re-parsed it), and Cursor's stream path
 * stamped `JSON.stringify(args)` unredacted (S4 review finding 5). Both are
 * gone; this module holds the one builder and the one salient list.
 *
 * THE PREVIEW NEVER CARRIES A VALUE IT CANNOT CARRY WHOLE. A non-salient
 * string over the per-value cap is left out of the preview — not replaced by
 * an in-band marker. The marker this module wrote until S4 M4R (`"[381
 * chars]"`) was a string no reader could tell from content: the approval gate
 * rendered it as the file the user was asked to approve (stigmer#1107). An
 * absent key is the out-of-band signal every reader already handles — a
 * surface that needs the whole value reads the row's `args`, the way the
 * gate does now; the codebase's precedent for "content not included" is a
 * typed fact on the wire (file review's `FileReviewBlockReason`), never a
 * display string, and the approval projection gaining such a fact is a
 * follow-up of its own. The cost, named: the CLI's and ink's one-line preview
 * loses the value's size, and Cursor's recovery digest reads `tool({})` for
 * an MCP tool whose only argument is oversized.
 */

/**
 * Argument keys whose values are secrets and must never appear in a preview.
 * Matched case-insensitively against the top-level key name.
 */
export const SENSITIVE_ARG_KEYS: ReadonlySet<string> = new Set([
  "password", "token", "secret", "api_key", "apikey",
  "credentials", "auth", "authorization",
]);

/**
 * Top-level tool-argument fields, in priority order, that identify the specific
 * resource a built-in tool acts on — the values a preview must carry VERBATIM,
 * however long, because an identity is parsed back out of them. The list
 * deliberately spans BOTH taxonomies' arg shapes: Cursor's hook input names a
 * file `file_path` and its stream names it `path`; deepagents' file tools send
 * `file_path`; both name a shell command `command`. Extracting the same
 * resource VALUE on both sides (the absolute path / the command string) is
 * what lets the Cursor hook-recorded denial token equal the stream-computed
 * token. Authored here once (moved from `execute-cursor/approval-policy.ts`
 * at S4 M2 C7, Q-M2-5) and injected into the generated preToolUse hook script
 * so the runner and the hook never disagree on which field to match.
 */
export const SALIENT_ARG_FIELDS = ["file_path", "path", "target_notebook", "command"] as const;

/**
 * Redact secret-keyed values (see {@link SENSITIVE_ARG_KEYS}), preserving every
 * other entry verbatim. The first step of the preview builder, and the shape
 * stamped as `args` on a proposed row the harness recovered from its engine's
 * state (issue #754's header fix): full enough for the UI's path/primary-arg
 * extraction, never carrying a secret value.
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

/** Per-string-value cap for {@link buildElidedArgsPreview}. */
const MAX_PREVIEW_VALUE_LENGTH = 200;

/**
 * Build a compact, ALWAYS-VALID `args_preview` from a tool call's full,
 * authoritative arguments.
 *
 * Leaves oversized string *values* out — every other key and the JSON
 * structure kept — rather than truncating the whole string. Two invariants
 * make it safe for the Cursor gate path:
 *  - It NEVER elides a salient field (the resume grant's identity — the file
 *    path or shell command — is parsed back out of this preview, so it must
 *    survive verbatim).
 *  - It redacts secret keys.
 *
 * For short, secret-free args the output is exactly `JSON.stringify(args)`.
 * The heavy content (a whole-file body, a large diff) lives on `file_changes`
 * (offloaded to a ref when large) and `args` (bounded by the size backstop), so
 * the preview itself stays small even for a multi-MB write. Unserializable
 * args (a cycle) yield `""`, never a thrown row.
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
      continue;
    }
    const oversized = typeof value === "string" && value.length > MAX_PREVIEW_VALUE_LENGTH;
    // An oversized non-salient value is left out, never marked (see the header).
    if (oversized && !salientFields.includes(key)) continue;
    out[key] = value;
  }
  try {
    return JSON.stringify(out);
  } catch {
    return "";
  }
}
