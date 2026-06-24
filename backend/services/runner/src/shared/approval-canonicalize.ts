// Deterministic canonicalization of a tool action into a byte-stable form.
// Domain: HITL approval. This is the cross-language contract the approval
// fingerprint (Phase 2) will hash; Phase 1 *defines and computes* it without
// hashing, so Go/Java/TS can be pinned to byte-identical output via the shared
// vector corpus (apis/testdata/hitl/canonicalization/).
//
// Why this exists: the March 2026 dedup bug was caused by hashing divergent
// representations of the same action (display args in one place, raw args in
// another). The fix is a single, explicit normalization pass — applied at ONE
// layer — that erases incidental differences (path separators, workspace
// location, shell whitespace, MCP slug case, secret values) before any hash.

import { createHash } from "node:crypto";
import { posix } from "node:path";

export interface ToolActionInput {
  // Engine tool name (Cursor PascalCase or native snake_case). Identity is kept
  // as-given (only trimmed) because ToolKind already normalizes cross-harness
  // naming elsewhere; canonicalization must not silently merge distinct tools.
  toolName: string;
  // MCP server slug, or empty/undefined for built-in tools.
  mcpServerSlug?: string;
  // File paths the action targets (absolute or workspace-relative).
  paths?: string[];
  // Shell command line, when this is a shell action.
  shellCommand?: string;
  // Remaining structured arguments.
  args?: Record<string, unknown>;
  // Top-level keys within `args` whose values are secrets: replaced by a stable
  // digest so the canonical form never carries cleartext.
  secretKeys?: string[];
  // Workspace root used to rewrite absolute paths to workspace-relative ones, so
  // the same edit canonicalizes identically regardless of checkout location.
  workspaceRoot?: string;
}

// The normalized action. Field order here is irrelevant — canonicalJson sorts
// keys — but the shape is the contract Go/Java must reproduce.
export interface CanonicalToolAction {
  toolName: string;
  mcpServerSlug: string;
  paths: string[];
  shellCommand: string;
  args: Record<string, unknown>;
}

export function canonicalizeToolAction(input: ToolActionInput): CanonicalToolAction {
  return {
    toolName: input.toolName.trim(),
    // Slugs are case-insensitive identity; lowercase so "GitHub" == "github".
    mcpServerSlug: (input.mcpServerSlug ?? "").trim().toLowerCase(),
    paths: normalizePaths(input.paths ?? [], input.workspaceRoot),
    shellCommand: normalizeShellCommand(input.shellCommand ?? ""),
    args: redactSecrets(input.args ?? {}, new Set(input.secretKeys ?? [])),
  };
}

// canonicalToolActionJson is the single entry point: normalize, then serialize
// to canonical JSON. The returned string is the byte-stable contract value.
export function canonicalToolActionJson(input: ToolActionInput): string {
  return canonicalJson(canonicalizeToolAction(input));
}

// canonicalJson serializes a value to RFC 8785-style canonical JSON: object keys
// sorted by UTF-16 code unit, no insignificant whitespace, UTF-8 output.
//
// The input domain is deliberately constrained to strings, booleans, null,
// integers, arrays, and plain objects — the shape of a normalized tool action.
// Non-integer numbers are rejected rather than implementing RFC 8785's full
// number-formatting algorithm, keeping this hand-rolled serializer small and
// provably cross-language without a third-party dependency. Revisit if the
// canonical domain ever needs floats.
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new Error("canonicalJson: non-finite number");
      if (!Number.isInteger(v)) {
        throw new Error("canonicalJson: non-integer numbers are not part of the canonical contract");
      }
      return String(v);
    case "string":
      // JSON.stringify produces the same minimal escaping and raw UTF-8 for
      // non-ASCII that RFC 8785 mandates for these inputs.
      return JSON.stringify(v);
    case "object":
      if (Array.isArray(v)) return "[" + v.map(serialize).join(",") + "]";
      return serializeObject(v as Record<string, unknown>);
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof v}`);
  }
}

function serializeObject(obj: Record<string, unknown>): string {
  // `undefined`-valued keys are dropped (they have no JSON representation);
  // remaining keys are sorted by UTF-16 code unit, which is JS's default string
  // ordering and matches RFC 8785.
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort(compareUtf16);
  const parts = keys.map((k) => JSON.stringify(k) + ":" + serialize(obj[k]));
  return "{" + parts.join(",") + "}";
}

function compareUtf16(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizePaths(paths: string[], workspaceRoot?: string): string[] {
  return paths.map((p) => normalizeOnePath(p, workspaceRoot)).sort(compareUtf16);
}

function normalizeOnePath(p: string, workspaceRoot?: string): string {
  // Separator-normalize to forward slashes first so Windows and POSIX agree.
  let s = p.replace(/\\/g, "/");
  if (workspaceRoot) {
    const root = workspaceRoot.replace(/\\/g, "/");
    if (s === root) {
      s = "";
    } else if (s.startsWith(root + "/")) {
      s = s.slice(root.length + 1);
    }
  }
  // Collapse `.`/`..` segments deterministically. posix.normalize("") -> ".".
  return s === "" ? "" : posix.normalize(s);
}

function normalizeShellCommand(cmd: string): string {
  // Collapse runs of whitespace to a single space and trim. The argument VALUE
  // (the command) is what matters; incidental spacing is not identity.
  return cmd.replace(/\s+/g, " ").trim();
}

function redactSecrets(
  args: Record<string, unknown>,
  secretKeys: Set<string>,
): Record<string, unknown> {
  if (secretKeys.size === 0) return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = secretKeys.has(k) ? redactValue(v) : v;
  }
  return out;
}

function redactValue(v: unknown): string {
  // Redact-but-stable: a SHA-256 digest keeps the canonical form stable across
  // runs without ever placing the secret in cleartext. This is NOT the approval
  // fingerprint — that is an HMAC keyed on a Stigmer secret, introduced in
  // Phase 2. This digest is unkeyed redaction only.
  const material = typeof v === "string" ? v : canonicalJson(v);
  return "sha256:" + createHash("sha256").update(material, "utf8").digest("hex");
}
