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
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

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
  // A rendered terminal session. `command` is the command that produced this
  // output (the prompt line) — it belongs here, not as a stray arg, because a
  // "terminal" view models the whole session (prompt + output), not output
  // alone. exitCode is parsed from the engine marker when present.
  | {
      readonly type: "terminal";
      readonly command?: string;
      readonly stdout: string;
      readonly stderr: string;
      readonly exitCode?: number;
    }
  // A search result. `kind` distinguishes the two shapes a search engine
  // returns: `"files"` is a file-name search (glob/file_search) whose matches are
  // paths to render as a file list; `"content"` is a grep-style search whose
  // matches carry line text (and a `file`/`line` when the engine provides them)
  // to render grouped by file. `count` is the authoritative total when the
  // engine reports it (it can exceed `matches.length` when `truncated`).
  // `kind`/`truncated` are optional so legacy/plain-text results (which only know
  // a flat match list) stay valid without them.
  | {
      readonly type: "search";
      readonly matches: readonly ToolSearchMatch[];
      readonly count: number;
      readonly kind?: "files" | "content";
      readonly truncated?: boolean;
    }
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
      return normalizeEdit(args, result);
    case ToolKind.FILE_WRITE:
      return normalizeWrite(args);
    case ToolKind.FILE_READ:
      return normalizeRead(args, result);
    case ToolKind.FILE_DELETE:
      return result ? { type: "text", text: result } : { type: "empty" };
    case ToolKind.SHELL:
      return normalizeShell(result, args);
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

function normalizeEdit(args: Args, result: string): ToolResultView {
  // The inline transcript diff for a file edit is reconstructed from the tool
  // args (there is no captured `file_changes` mirror — apply-then-review renders
  // captured diffs via FileReviewCard/FileChangeDiff, not here). The native
  // engine returns prose with no diff, so the presentation layer computes the
  // visual diff from the args fragments; the Cursor SDK returns a stringified
  // envelope with precomputed diff stats.
  const path = firstString(args, PATH_FIELDS) ?? "";
  const oldText = firstString(args, OLD_TEXT_FIELDS);
  const newText = firstString(args, NEW_TEXT_FIELDS);

  const value = cursorEnvelopeValue(tryParseJson(result));
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

function normalizeWrite(args: Args): ToolResultView {
  // The inline transcript view for a file write is the proposed content from the
  // tool args (captured diffs render via FileReviewCard, not here).
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

function normalizeShell(result: string, args: Args): ToolResultView {
  // The command is the session's prompt line. "command" matches the shell
  // primaryField shared with the runner/Go classifier and both native and
  // Cursor args, so no fallback fields are needed.
  const command = firstString(args, ["command"]);

  // Two shapes carry structured shell output: native sub-agent steps emit the
  // {stdout,stderr,exitCode} record directly; the Cursor SDK nests it under a
  // {status, value} envelope (the same envelope the edit tool uses). Read
  // whichever is present so the real output surfaces instead of the raw JSON
  // string. A failed shell never reaches here — normalizeToolResult routes
  // TOOL_CALL_FAILED to the error view first — so only success is handled.
  const parsed = tryParseJson(result);
  const shell = hasShellFields(parsed) ? parsed : cursorEnvelopeValue(parsed);
  if (hasShellFields(shell)) {
    return {
      type: "terminal",
      command,
      stdout: asString(shell.stdout) ?? "",
      stderr: asString(shell.stderr) ?? "",
      exitCode: asNumber(shell.exitCode),
    };
  }

  const marker = result.match(SHELL_EXIT_MARKER);
  if (marker) {
    const stdout = result.replace(SHELL_EXIT_MARKER, "");
    // Group 1 is set only on failure; a matched marker without it is success (0).
    const exitCode = marker[1] !== undefined ? Number(marker[1]) : 0;
    return { type: "terminal", command, stdout, stderr: "", exitCode };
  }

  return { type: "terminal", command, stdout: result, stderr: "" };
}

// A grep-style match line, e.g. "  12: // TODO: fix".
const GREP_MATCH_LINE = /^\s*\d+[:\t]/;

// The Cursor SDK returns search results as a stringified JSON envelope, not the
// plain text the native harness emits. Two shapes are observed, both fixture-
// backed in test/fixtures/tool-view/result-views.json:
//   - file-name search (Glob/file_search): the {status,value} envelope with
//     value.files (paths), value.totalFiles, and the truncation flags.
//   - grep / codebase search: {workspaceResults: {<path>: {type, output}}},
//     where each workspace's output carries files and/or line-bearing matches.
// Anything we don't recognise degrades to the json view (readable) rather than
// being wrapped as a single fake match by the plain-text path below.
function normalizeSearch(result: string): ToolResultView {
  const parsed = tryParseJson(result);
  if (parsed !== undefined) {
    const fromEnvelope = searchFromEnvelope(parsed);
    if (fromEnvelope) {
      return fromEnvelope;
    }
    // Recognised JSON shape but nothing searchable in it (or an unknown shape):
    // a clean json/object view beats wrapping the raw string as one "match".
    if (isRecord(parsed) || Array.isArray(parsed)) {
      return { type: "json", value: parsed };
    }
  }

  return searchFromPlainText(result);
}

// Projects a parsed Cursor search envelope into a search view, or null when the
// parsed JSON is not one of the recognised search shapes.
//
// Both shapes are wrapped in the Cursor {status,value} envelope (shared with
// edit/shell), so the payload lives under `value`: file-name search puts `files`
// there, grep/codebase search puts `workspaceResults` there. We read the inner
// value when present and fall back to the parsed object itself, so a future
// un-enveloped shape still resolves rather than dropping to the json fallback.
function searchFromEnvelope(parsed: unknown): ToolResultView | null {
  const inner = cursorEnvelopeValue(parsed) ?? (isRecord(parsed) ? parsed : undefined);
  if (!inner) return null;

  const truncated =
    Boolean(inner.clientTruncated) || Boolean(inner.ripgrepTruncated);

  // file-name search (Glob/file_search): inner.files is an array of path strings.
  if (Array.isArray(inner.files)) {
    const matches = pathsToFileMatches(inner.files);
    const count = asNumber(inner.totalFiles) ?? matches.length;
    // Safety net: the engine reports results but we extracted none — the shape
    // drifted (e.g. files are objects, not strings). Surface the raw JSON rather
    // than a misleading "No files found" that hides real data. (Truncation always
    // returns a non-empty page, so this never fires on a legitimately capped result.)
    if (count > 0 && matches.length === 0) return null;
    return { type: "search", matches, count, kind: "files", truncated };
  }

  // grep / codebase search: inner.workspaceResults maps a workspace path to its
  // { type, output }. Flatten every workspace's output into one match list so a
  // multi-root search reads as a single result. Truncation can be reported at the
  // envelope level (passed in) or per-workspace (read inside).
  if (isRecord(inner.workspaceResults)) {
    return searchFromWorkspaceResults(inner.workspaceResults, truncated);
  }

  return null;
}

// Flattens the per-workspace results of a grep/codebase search. Each workspace's
// `output` carries `files` (path matches) and/or `matches` (line-bearing content
// matches); both are collected, and `truncated` is OR-ed across workspaces.
//
// Returns null when the engine reports results (count > 0) but none could be
// extracted — a shape drift — so the caller degrades to the raw JSON view rather
// than silently rendering "No files found" over data that is actually there.
function searchFromWorkspaceResults(
  workspaceResults: Record<string, unknown>,
  envelopeTruncated: boolean,
): ToolResultView | null {
  const fileMatches: ToolSearchMatch[] = [];
  const contentMatches: ToolSearchMatch[] = [];
  let reportedCount = 0;
  let hasReportedCount = false;
  let truncated = envelopeTruncated;

  for (const ws of Object.values(workspaceResults)) {
    const output = isRecord(ws) ? ws.output : undefined;
    if (!isRecord(output)) continue;

    if (Array.isArray(output.files)) {
      fileMatches.push(...pathsToFileMatches(output.files));
    }
    if (Array.isArray(output.matches)) {
      contentMatches.push(...toContentMatches(output.matches));
    }

    const count = asNumber(output.count);
    if (count !== undefined) {
      reportedCount += count;
      hasReportedCount = true;
    }
    if (Boolean(output.clientTruncated) || Boolean(output.ripgrepTruncated)) {
      truncated = true;
    }
  }

  // Content matches are the richer signal, so when present they drive the view;
  // otherwise the result is a file-name list.
  const isContent = contentMatches.length > 0;
  const matches = isContent ? contentMatches : fileMatches;

  // Safety net: results were reported but none extracted — the per-workspace
  // output shape drifted. Bail to the raw JSON view (see the caller) instead of
  // hiding the data behind a "No matches".
  if (hasReportedCount && reportedCount > 0 && matches.length === 0) {
    return null;
  }

  return {
    type: "search",
    matches,
    count: hasReportedCount ? reportedCount : matches.length,
    kind: isContent ? "content" : "files",
    truncated,
  };
}

// Maps an engine-provided array of file paths into file-name matches. Both
// `file` and `text` are set to the path so a kind-unaware consumer (e.g. the Ink
// summary) still shows something useful. Non-string entries are skipped.
function pathsToFileMatches(files: readonly unknown[]): ToolSearchMatch[] {
  const matches: ToolSearchMatch[] = [];
  for (const f of files) {
    if (typeof f === "string" && f.length > 0) {
      matches.push({ file: f, text: f });
    }
  }
  return matches;
}

// Maps an engine-provided array of grep matches into content matches. Each entry
// is read defensively (the exact shape is engine-fragile): a `file`/`path` and a
// 1-based `line` are carried when present, and the line text is taken from the
// first available text field, falling back to the stringified entry.
function toContentMatches(rawMatches: readonly unknown[]): ToolSearchMatch[] {
  const matches: ToolSearchMatch[] = [];
  for (const m of rawMatches) {
    if (typeof m === "string") {
      if (m.length > 0) matches.push({ text: m });
      continue;
    }
    if (!isRecord(m)) continue;
    const file = asString(m.file) ?? asString(m.path);
    const line = asNumber(m.line) ?? asNumber(m.lineNumber);
    const text = asString(m.text) ?? asString(m.line_text) ?? asString(m.content) ?? "";
    matches.push({ file, line, text });
  }
  return matches;
}

// The plain-text path for the native harness: grep emits "  12: match" lines;
// glob/semantic search emit one path per line.
function searchFromPlainText(result: string): ToolResultView {
  const lines = nonEmptyLines(result);
  const matchLines = lines.filter((l) => GREP_MATCH_LINE.test(l));

  if (matchLines.length > 0) {
    const matches = matchLines.map((l) => ({ text: l.trim() }));
    return { type: "search", matches, count: matches.length, kind: "content" };
  }

  // Path/name results (glob, semantic search): each meaningful line is a match.
  const entries = lines.filter((l) => !/^no (files|matches|results)/i.test(l));
  const matches = entries.map((text) => ({ file: text, text }));
  return { type: "search", matches, count: matches.length, kind: "files" };
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

// The Cursor SDK wraps tool payloads in a {status, value} envelope. Returns the
// inner `value` record when present, so edit and shell read the envelope through
// one definition instead of each re-deriving its shape.
function cursorEnvelopeValue(parsed: unknown): Record<string, unknown> | undefined {
  return isRecord(parsed) && isRecord(parsed.value) ? parsed.value : undefined;
}

// True when a record carries structured shell output (stdout/exitCode). Used to
// pick between the un-enveloped native shape and the Cursor envelope's inner
// value in normalizeShell.
function hasShellFields(v: unknown): v is Record<string, unknown> {
  return isRecord(v) && ("stdout" in v || "exitCode" in v);
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
