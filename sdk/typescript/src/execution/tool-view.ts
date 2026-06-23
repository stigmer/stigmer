// Framework-agnostic tool-call view model for every Stigmer surface.
//
// Two pure functions normalize the two things clients keep re-deriving from
// harness-specific data:
//   - resolveToolKind: the harness-agnostic ToolKind (wire field, with a
//     name-based fallback for legacy executions persisted before tool_kind).
//   - normalizeToolResult: the opaque result string -> a typed ToolResultView
//     that presentation layers (React, Ink, the Go CLI's equivalent) render
//     without re-parsing third-party engine formats.
//
// For file edits, normalizeToolResult prefers the runner's authoritative
// before/after capture (ToolCall.file_changes, #186) over reconstructing a diff
// from args, surfacing the capture's fidelity via the diff view's captureLevel so
// the renderer is honest about whole-file vs hunk-only. The capture is a clean,
// structured proto, so it is consumed proto-first rather than re-modeled here;
// the repeated/multi-file projection and offloaded-body fetching live in the
// React layer. Counts and unified diffs for a whole-file capture stay derivable
// by the presentation layer (the runner emits 0/"" sentinels for them), keeping
// one diff implementation as the source of truth.
//
// This module has no React or framework dependency so it can be shared by
// @stigmer/react and @stigmer/ink. The Go CLI mirrors it; the shared contract
// is test/fixtures/tool-view/. Engine result formats are version-fragile, so
// every assumption here is fixture-backed and degrades gracefully to json/text.

import { ToolKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { FileChangeCaptureLevel } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCall, FileChange, FileContent } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

export { ToolKind, FileChangeCaptureLevel };

/** A single match in a search/grep result. */
export interface ToolSearchMatch {
  /** File path the match was found in, when the result format provides it. */
  readonly file?: string;
  /** 1-based line number, when available. */
  readonly line?: number;
  /** The matched text. */
  readonly text: string;
}

/** An MCP content block (the `content: [...]` array MCP servers return). */
export interface ToolContentBlock {
  /** Block type, e.g. "text". */
  readonly type: string;
  /** Text payload, when the block is textual. */
  readonly text?: string;
}

/**
 * A typed projection of a tool call's result, discriminated by `type`.
 *
 * Presentation layers switch on `type` and never re-parse the raw string. The
 * `json` and `text` variants are the guaranteed graceful-degradation fallbacks:
 * any unrecognized or truncated payload lands there, so this is never worse than
 * showing the raw result.
 */
export type ToolResultView =
  // File edit. oldText/newText are the two sides of the change: the authoritative
  // whole-file before/after captured by the runner (ToolCall.file_changes) when
  // available, otherwise the old_string/new_string fragments from args. The
  // presentation layer computes the visual diff (and its line counts) from
  // oldText/newText; linesAdded/linesRemoved/unifiedDiff are populated only when
  // the source provides them directly (e.g. the Cursor hunk-only envelope).
  //
  // captureLevel reports the fidelity of oldText/newText so the renderer can be
  // honest about it: WHOLE_FILE (full-file before/after), HUNK_ONLY (Cursor's
  // hunk diff, no whole-file content), or undefined (reconstructed from args, the
  // legacy path). It is the one fact field presence alone cannot convey, since a
  // whole-file capture and an args fragment both populate oldText/newText.
  | {
      readonly type: "diff";
      readonly path: string;
      readonly oldText?: string;
      readonly newText?: string;
      readonly linesAdded?: number;
      readonly linesRemoved?: number;
      readonly unifiedDiff?: string;
      readonly captureLevel?: FileChangeCaptureLevel;
    }
  // File read or full-file write. `content` is the file body (from result for
  // read, from args for write).
  | {
      readonly type: "file";
      readonly path: string;
      readonly content: string;
      readonly language?: string;
      readonly truncated: boolean;
    }
  // Shell command output. exitCode is parsed from the engine marker when present.
  | {
      readonly type: "terminal";
      readonly stdout: string;
      readonly stderr: string;
      readonly exitCode?: number;
    }
  | { readonly type: "search"; readonly matches: readonly ToolSearchMatch[]; readonly count: number }
  | { readonly type: "list"; readonly entries: readonly string[]; readonly count: number }
  | {
      readonly type: "contentBlocks";
      readonly blocks: readonly ToolContentBlock[];
      readonly mcpServerSlug: string;
    }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "json"; readonly value: unknown }
  | { readonly type: "error"; readonly message: string }
  // Output offloaded to artifact storage to keep the status payload small (e.g. a
  // screenshot from a computer-use MCP server or a multi-MB dump). The bytes are
  // resolved on demand from `storageKey` at view time (never from a baked URL,
  // which expires); `preview` is a short inline head for non-image content.
  | {
      readonly type: "outputRef";
      readonly storageKey: string;
      readonly contentHash: string;
      readonly isImage: boolean;
      readonly mimeType: string;
      readonly sizeBytes: number;
      readonly preview: string;
    }
  // Nothing to render (e.g. a delete confirmation, or a result not yet produced).
  | { readonly type: "empty" };

// ---------------------------------------------------------------------------
// Identity: resolveToolKind
// ---------------------------------------------------------------------------

// Fallback name -> ToolKind map for legacy executions (tool_kind == UNSPECIFIED)
// and any consumer that only has a name. Mirrors the runner classifier and the
// Go CLI; kept honest by test/fixtures/tool-view/classification.json.
const NAME_TO_KIND: ReadonlyMap<string, ToolKind> = new Map([
  ["read", ToolKind.FILE_READ],
  ["read_file", ToolKind.FILE_READ],
  ["Read", ToolKind.FILE_READ],

  ["write", ToolKind.FILE_WRITE],
  ["write_file", ToolKind.FILE_WRITE],
  ["create_file", ToolKind.FILE_WRITE],
  ["overwrite_file", ToolKind.FILE_WRITE],
  ["Write", ToolKind.FILE_WRITE],

  ["edit", ToolKind.FILE_EDIT],
  ["edit_file", ToolKind.FILE_EDIT],
  ["str_replace_editor", ToolKind.FILE_EDIT],
  ["StrReplace", ToolKind.FILE_EDIT],
  ["EditNotebook", ToolKind.FILE_EDIT],

  ["delete", ToolKind.FILE_DELETE],
  ["delete_file", ToolKind.FILE_DELETE],
  ["remove_file", ToolKind.FILE_DELETE],
  ["Delete", ToolKind.FILE_DELETE],

  ["shell", ToolKind.SHELL],
  ["bash", ToolKind.SHELL],
  ["execute", ToolKind.SHELL],
  ["execute_command", ToolKind.SHELL],
  ["run_command", ToolKind.SHELL],
  ["terminal", ToolKind.SHELL],
  ["Shell", ToolKind.SHELL],

  ["grep", ToolKind.SEARCH],
  ["glob", ToolKind.SEARCH],
  ["search", ToolKind.SEARCH],
  ["ripgrep", ToolKind.SEARCH],
  ["find_files", ToolKind.SEARCH],
  ["Grep", ToolKind.SEARCH],
  ["Glob", ToolKind.SEARCH],
  ["SemanticSearch", ToolKind.SEARCH],

  ["ls", ToolKind.LIST],
  ["list_directory", ToolKind.LIST],

  ["WebFetch", ToolKind.FETCH],
  ["WebSearch", ToolKind.WEB_SEARCH],

  ["think", ToolKind.THINK],

  ["write_todos", ToolKind.TODO],
  ["updateTodos", ToolKind.TODO],
  ["TodoWrite", ToolKind.TODO],

  ["task", ToolKind.SUBAGENT],
  ["Task", ToolKind.SUBAGENT],
]);

/**
 * Resolves the harness-agnostic kind of a tool call.
 *
 * Prefers the wire `tool_kind` set by the runner; falls back to a name lookup
 * for legacy executions where it is UNSPECIFIED. An unknown name with a
 * non-empty mcpServerSlug is an MCP tool.
 */
export function resolveToolKind(toolCall: Pick<ToolCall, "name" | "mcpServerSlug" | "toolKind">): ToolKind {
  if (toolCall.toolKind !== undefined && toolCall.toolKind !== ToolKind.UNSPECIFIED) {
    return toolCall.toolKind;
  }
  return resolveToolKindByName(toolCall.name, toolCall.mcpServerSlug);
}

/** Name-based classification used as the legacy fallback for resolveToolKind. */
export function resolveToolKindByName(name: string, mcpServerSlug?: string): ToolKind {
  const builtin = NAME_TO_KIND.get(name);
  if (builtin !== undefined) {
    return builtin;
  }
  if (mcpServerSlug && mcpServerSlug.length > 0) {
    return ToolKind.MCP;
  }
  return ToolKind.UNSPECIFIED;
}

// ---------------------------------------------------------------------------
// Result: normalizeToolResult
// ---------------------------------------------------------------------------

type Args = Record<string, unknown> | undefined;

const PATH_FIELDS = ["path", "file_path", "file", "filename"] as const;
const OLD_TEXT_FIELDS = ["old_string", "old_text", "oldText"] as const;
const NEW_TEXT_FIELDS = ["new_string", "new_text", "newText", "replacement"] as const;
const WRITE_CONTENT_FIELDS = ["contents", "content", "file_content"] as const;

/**
 * Normalizes a tool call into a typed ToolResultView for rendering.
 *
 * A FAILED tool with an error always yields an `error` view. Otherwise the kind
 * drives interpretation, and anything unrecognized degrades to `json`/`text`.
 */
export function normalizeToolResult(toolCall: ToolCall): ToolResultView {
  const result = toolCall.result ?? "";
  const args = toolCall.args as Args;

  if (toolCall.status === ToolCallStatus.TOOL_CALL_FAILED && (toolCall.error || result)) {
    return { type: "error", message: toolCall.error || result };
  }

  // Output was offloaded to artifact storage (too large to inline): the real
  // bytes are no longer in `result` (which holds only a short head/label), so
  // render from the reference instead of re-parsing the placeholder. The view
  // carries the stable `storageKey` so consumers resolve the bytes/URL on
  // demand — the persisted URL was ephemeral and is no longer trusted.
  if (toolCall.outputRef && toolCall.outputRef.storageKey) {
    const ref = toolCall.outputRef;
    return {
      type: "outputRef",
      storageKey: ref.storageKey,
      contentHash: ref.contentHash,
      isImage: ref.isImage,
      mimeType: ref.mimeType,
      sizeBytes: Number(ref.sizeBytes),
      preview: ref.truncatedPreview || result,
    };
  }

  const kind = resolveToolKind(toolCall);

  switch (kind) {
    case ToolKind.FILE_EDIT:
      return normalizeEdit(toolCall.fileChanges, args, result);
    case ToolKind.FILE_WRITE:
      return normalizeWrite(args);
    case ToolKind.FILE_READ:
      return normalizeRead(args, result);
    case ToolKind.FILE_DELETE:
      return result ? { type: "text", text: result } : { type: "empty" };
    case ToolKind.SHELL:
      return normalizeShell(result);
    case ToolKind.SEARCH:
      return normalizeSearch(result);
    case ToolKind.LIST:
      return normalizeList(result);
    case ToolKind.THINK:
      return normalizeThink(args, result);
    case ToolKind.MCP:
      return normalizeMcp(result, toolCall.mcpServerSlug);
    default:
      return genericView(result);
  }
}

function normalizeEdit(
  fileChanges: readonly FileChange[],
  args: Args,
  result: string,
): ToolResultView {
  // Prefer the runner's authoritative capture (ToolCall.file_changes) over
  // reconstructing the diff from args. A FILE_EDIT touches a single file, so the
  // first change is the relevant one; multi-file changes (some MCP tools) are not
  // routed here and are consumed wholesale from the proto by higher layers.
  const captured = fileChanges[0] && normalizeEditFromFileChange(fileChanges[0], args);
  if (captured) {
    return captured;
  }

  // Legacy fallback: no file_changes (executions persisted before #186) or an
  // unrecognized capture level. The native engine returns prose with no diff, so
  // the presentation layer computes the visual diff from the args fragments; the
  // Cursor SDK returns a stringified envelope with precomputed diff stats.
  const path = firstString(args, PATH_FIELDS) ?? "";
  const oldText = firstString(args, OLD_TEXT_FIELDS);
  const newText = firstString(args, NEW_TEXT_FIELDS);

  const envelope = tryParseJson(result);
  const value = isRecord(envelope) && isRecord(envelope.value) ? envelope.value : undefined;
  const linesAdded = value ? asNumber(value.linesAdded) : undefined;
  const linesRemoved = value ? asNumber(value.linesRemoved) : undefined;
  const unifiedDiff = value ? asString(value.diffString) : undefined;

  return {
    type: "diff",
    path,
    oldText,
    newText,
    linesAdded,
    linesRemoved,
    unifiedDiff,
  };
}

// Projects an authoritative FileChange into the diff view. Returns undefined for
// an UNSPECIFIED capture level so the caller falls back to the args path.
function normalizeEditFromFileChange(change: FileChange, args: Args): ToolResultView | undefined {
  const path = change.path || change.absolutePath || firstString(args, PATH_FIELDS) || "";

  switch (change.captureLevel) {
    case FileChangeCaptureLevel.WHOLE_FILE:
      // True whole-file before/after. linesAdded/linesRemoved and unified_diff are
      // intentionally NOT copied: for a whole-file capture the native harness
      // leaves them as 0/"" sentinels (backend shared/file-change.ts), so the
      // presentation layer derives the stats and hunks from oldText/newText, as it
      // already does. A side that was offloaded or is binary has no inline text and
      // is left unset rather than fabricated (see inlineFileBody).
      return {
        type: "diff",
        path,
        oldText: inlineFileBody(change.before),
        newText: inlineFileBody(change.after),
        captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
      };
    case FileChangeCaptureLevel.HUNK_ONLY:
      // Cursor today: a hunk-level unified diff plus authoritative line counts,
      // with no whole-file content. The diff string is the renderable payload.
      return {
        type: "diff",
        path,
        unifiedDiff: change.unifiedDiff || undefined,
        linesAdded: change.linesAdded,
        linesRemoved: change.linesRemoved,
        captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
      };
    default:
      return undefined;
  }
}

// Returns the inline UTF-8 body of one side of a file change, or undefined when
// the side is absent, was offloaded to artifact storage (body.case === "ref"), or
// is binary — none of which can be shown as inline diff text. An empty file is a
// real inline value ("") and is preserved, distinct from an absent side.
function inlineFileBody(side: FileContent | undefined): string | undefined {
  if (!side || side.isBinary) {
    return undefined;
  }
  return side.body.case === "inline" ? side.body.value : undefined;
}

function normalizeWrite(args: Args): ToolResultView {
  const path = firstString(args, PATH_FIELDS) ?? "";
  const content = firstString(args, WRITE_CONTENT_FIELDS) ?? "";
  return { type: "file", path, content, language: languageFromPath(path), truncated: false };
}

function normalizeRead(args: Args, result: string): ToolResultView {
  const path = firstString(args, PATH_FIELDS) ?? "";
  return {
    type: "file",
    path,
    content: result,
    language: languageFromPath(path),
    truncated: isTruncated(result),
  };
}

// Matches the deepagents shell marker, e.g. "[Command failed with exit code 2]"
// or "[Command succeeded]". Format owned by the engine — see DD-003; covered by
// test/fixtures/tool-view/result-views.json so a format change fails one test.
const SHELL_EXIT_MARKER = /\n?\[Command (?:succeeded|failed with exit code (\d+))\]\s*$/;

function normalizeShell(result: string): ToolResultView {
  // Cursor sub-agent steps can carry a structured {stdout,stderr,exitCode}.
  const parsed = tryParseJson(result);
  if (isRecord(parsed) && ("stdout" in parsed || "exitCode" in parsed)) {
    return {
      type: "terminal",
      stdout: asString(parsed.stdout) ?? "",
      stderr: asString(parsed.stderr) ?? "",
      exitCode: asNumber(parsed.exitCode),
    };
  }

  const marker = result.match(SHELL_EXIT_MARKER);
  if (marker) {
    const stdout = result.replace(SHELL_EXIT_MARKER, "");
    // Group 1 is set only on failure; a matched marker without it is success (0).
    const exitCode = marker[1] !== undefined ? Number(marker[1]) : 0;
    return { type: "terminal", stdout, stderr: "", exitCode };
  }

  return { type: "terminal", stdout: result, stderr: "" };
}

// A grep-style match line, e.g. "  12: // TODO: fix".
const GREP_MATCH_LINE = /^\s*\d+[:\t]/;

function normalizeSearch(result: string): ToolResultView {
  const lines = nonEmptyLines(result);
  const matchLines = lines.filter((l) => GREP_MATCH_LINE.test(l));

  if (matchLines.length > 0) {
    const matches = matchLines.map((l) => ({ text: l.trim() }));
    return { type: "search", matches, count: matches.length };
  }

  // Path/name results (glob, semantic search): each meaningful line is a match.
  const entries = lines.filter((l) => !/^no (files|matches|results)/i.test(l));
  const matches = entries.map((text) => ({ text }));
  return { type: "search", matches, count: matches.length };
}

function normalizeList(result: string): ToolResultView {
  const entries = nonEmptyLines(result);
  return { type: "list", entries, count: entries.length };
}

function normalizeThink(args: Args, result: string): ToolResultView {
  const thought = firstString(args, ["thought"]) ?? result;
  return { type: "text", text: thought };
}

function normalizeMcp(result: string, mcpServerSlug: string): ToolResultView {
  const parsed = tryParseJson(result);
  const blocks = extractContentBlocks(parsed);
  if (blocks) {
    return { type: "contentBlocks", blocks, mcpServerSlug };
  }
  if (parsed !== undefined && (isRecord(parsed) || Array.isArray(parsed))) {
    return { type: "json", value: parsed };
  }
  return result ? { type: "text", text: result } : { type: "empty" };
}

function genericView(result: string): ToolResultView {
  if (!result) {
    return { type: "empty" };
  }
  const parsed = tryParseJson(result);
  if (parsed !== undefined && (isRecord(parsed) || Array.isArray(parsed))) {
    return { type: "json", value: parsed };
  }
  return { type: "text", text: result };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstString(args: Args, fields: readonly string[]): string | undefined {
  if (!args) return undefined;
  for (const f of fields) {
    const v = args[f];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function nonEmptyLines(s: string): string[] {
  return s.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim().length > 0);
}

function tryParseJson(s: string): unknown {
  const trimmed = s.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function extractContentBlocks(parsed: unknown): ToolContentBlock[] | null {
  const content = isRecord(parsed) ? parsed.content : Array.isArray(parsed) ? parsed : undefined;
  if (!Array.isArray(content)) return null;
  const blocks: ToolContentBlock[] = [];
  for (const item of content) {
    if (isRecord(item) && typeof item.type === "string") {
      blocks.push({ type: item.type, text: asString(item.text) });
    }
  }
  return blocks.length > 0 ? blocks : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function isTruncated(result: string): boolean {
  return /\[truncated: \d+ chars total\]/.test(result);
}

const EXTENSION_TO_LANGUAGE: ReadonlyMap<string, string> = new Map([
  ["ts", "typescript"], ["tsx", "tsx"], ["js", "javascript"], ["jsx", "jsx"],
  ["py", "python"], ["go", "go"], ["rs", "rust"], ["java", "java"],
  ["rb", "ruby"], ["sh", "bash"], ["md", "markdown"], ["json", "json"],
  ["yaml", "yaml"], ["yml", "yaml"], ["proto", "protobuf"], ["sql", "sql"],
  ["css", "css"], ["html", "html"], ["toml", "toml"],
]);

function languageFromPath(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return undefined;
  return EXTENSION_TO_LANGUAGE.get(path.slice(dot + 1).toLowerCase());
}
