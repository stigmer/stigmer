import type { JsonObject } from "@bufbuild/protobuf";
import {
  type ToolKind,
  isSecretArgKey,
  resolveToolKind,
  resolveToolKindByName,
  shellIntentFromArgs,
  type ToolUse,
} from "@stigmer/client";

/** What the presentation helpers read of a tool use: its name, MCP server and input. */
/** The two fields of a tool use its category is read from. */
export type ToolIdentity = Pick<ToolUse, "name" | "mcpServerName">;

/**
 * Discriminated tool categories for type-aware rendering.
 *
 * This is the presentation taxonomy. Classification (name -> kind) lives in
 * `@stigmer/client`'s `resolveToolKind` (single source of truth, shared with the
 * runner, @stigmer/ink-ui, and the CLI's headless renderers); this file maps each
 * {@link ToolKind} to its presentation metadata (label, primary argument).
 * `"mcp"` covers tools originating from an MCP server, whose names are
 * dynamic.
 */
export type ToolCategory =
  | "shell"
  | "read"
  | "write"
  | "edit"
  | "delete"
  | "search"
  | "list"
  | "fetch"
  | "web-search"
  | "think"
  | "subagent"
  | "internal"
  | "mcp"
  | "memory"
  | "background-stop"
  | "skill"
  | "unknown";

/**
 * How much of a settled tool call to reveal inline by default in the thread.
 *
 * - `"summary"` — a compact one-line row. Used when the label + primary arg +
 *   result summary already tell the story (`Read foo.ts`, `Edit bar.ts +40 -0`,
 *   `Search … 2 matches`). The full detail is one click away.
 * - `"preview"` — the row renders its result body **always** (no card chevron),
 *   because the one-liner cannot convey what happened so the content itself IS
 *   the information (an MCP result such as a screenshot, a fetched page, a
 *   web-search answer, or an unrecognised tool's output). The body's own
 *   in-place reveal expands it beyond the height budget.
 * - `"tail"` — live like `"preview"`, settled like a teaser: while the tool
 *   runs (or awaits approval) the full body streams in view; once it settles
 *   successfully the row collapses to a dimmed tail of its last output lines —
 *   at-a-glance evidence that it ran and what it printed last — expanding on
 *   demand via the header chevron. A settled *failure* stays open: error
 *   output is content, not context. Shell is the canonical tail category — a
 *   working session's compile/validate loops would otherwise dominate the
 *   transcript at full contrast (Cursor's chat is the reference UX).
 *
 * This is the *disclosure* axis (how much of a result to show); it is
 * orthogonal to `isRunGroupableCategory` (whether consecutive same-kind
 * calls fold into one chip). A category can be result-rich but never folded
 * (`shell`), or foldable but never previewed (`read`).
 */
export type ToolDisclosure = "summary" | "preview" | "tail";

/**
 * How much *chrome* a tool row carries in the thread — the density axis,
 * orthogonal to {@link ToolDisclosure} (how much of the result to show).
 *
 * - `"card"` — a self-contained bordered card. For content-bearing rows
 *   (shell, edit, fetch, MCP), where the body is real evidence worth a frame.
 * - `"quiet"` — an unboxed single text line, no border, no card. For
 *   metadata-only rows (read / list / search / think) whose label + argument
 *   already tell the whole story: a 4 ms directory listing must not shout as
 *   loudly as a 3-minute shell run (Cursor's chat is the reference UX — prose
 *   with quiet evidence attached, not a stack of equally-loud widgets).
 *
 * This is the *settled default*. A row escalates to `"card"` regardless of
 * category while it carries something the quiet line cannot: a pending
 * approval gate (a decision surface) or a failure (error output is content).
 * That escalation is owned by the component layer and is deliberately not
 * override-able — a gate must never render without its frame.
 */
export type ToolChrome = "card" | "quiet";

/**
 * Categories whose settled summary row IS the complete information, rendered
 * as quiet unboxed lines by default. Mirrors {@link RUN_GROUPABLE_CATEGORIES}
 * plus `think` (a thought's row reads like narration, not evidence) — the
 * same low-signal set, on the chrome axis instead of the folding axis.
 */
const QUIET_CATEGORIES: ReadonlySet<ToolCategory> = new Set<ToolCategory>([
  "read",
  "list",
  "search",
  "think",
  // The agent's stop of a background command reads as narration ("Stopped
  // `npm test`"): the command's own row carries its output and its end.
  "background-stop",
  // A loaded skill reads as narration ("Use skill review"): the skill's
  // instructions are the model's, not evidence to show.
  "skill",
]);

/**
 * Returns the default {@link ToolChrome} for a presentation category.
 * Consumers can override per {@link ToolKind} via {@link registerToolPresenter}
 * (`chrome: () => "card"` to restore the boxed look for a kind), exactly like
 * the disclosure axis.
 */
export function defaultChromeForCategory(category: ToolCategory): ToolChrome {
  return QUIET_CATEGORIES.has(category) ? "quiet" : "card";
}

/**
 * Categories whose result is foregrounded as a persistent bounded preview by
 * default — those for which the compact one-liner cannot convey what happened,
 * so the output itself carries the meaning. All other categories default to
 * `"summary"`.
 *
 * File edits and writes are previewed: a `+N -M` summary says how much changed
 * but not *what* — and the change is the decision-relevant content. Surfacing a
 * bounded diff inline (Cursor-style) is the point of a code agent. The body is
 * height-clamped with a single in-place reveal for the rest, so density stays
 * under control even in turns with many edits.
 */
const PREVIEW_CATEGORIES: ReadonlySet<ToolCategory> = new Set<ToolCategory>([
  "edit",
  "write",
  "mcp",
  "web-search",
  "fetch",
  // A memory proposal is a decision surface: the verbatim fact and the
  // Confirm/Reject actions ARE the content — never fold it behind a chevron
  // (a proposal the user scrolled past is caught by the memory
  // page, but the chip must not hide itself while in view).
  "memory",
  "unknown",
]);

/**
 * Categories that stream in full while live but settle to a dimmed tail of
 * their last output lines (see the `"tail"` arm of {@link ToolDisclosure}).
 * Today that is shell alone: its output is evidence worth keeping at a
 * glance, but rarely worth reading line by line once the command succeeded.
 * Consumers can restore the always-expanded preview per kind via
 * {@link registerToolPresenter} (`disclosure: () => "preview"`).
 */
const TAIL_CATEGORIES: ReadonlySet<ToolCategory> = new Set<ToolCategory>([
  "shell",
]);

/**
 * Low-signal categories whose consecutive runs fold into a single collapsible
 * "Read 5 files" chip in the thread. These are the read-only, repetitive
 * operations whose individual rows are noise in bulk; everything else renders
 * as a persistent row. This is the *run-grouping* axis, orthogonal to
 * {@link ToolDisclosure} — see `isRunGroupableCategory`.
 */
const RUN_GROUPABLE_CATEGORIES: ReadonlySet<ToolCategory> = new Set<ToolCategory>([
  "read",
  "list",
  "search",
]);

/**
 * Returns the default inline {@link ToolDisclosure} for a presentation
 * category. This is the headless policy behind the thread's "collapse settled
 * shell to a dimmed tail, keep a live preview for MCP/unknown, keep generic
 * tools compact" behaviour; consumers can override per {@link ToolKind} via
 * {@link registerToolPresenter}.
 */
export function defaultDisclosureForCategory(
  category: ToolCategory,
): ToolDisclosure {
  if (TAIL_CATEGORIES.has(category)) return "tail";
  return PREVIEW_CATEGORIES.has(category) ? "preview" : "summary";
}

/**
 * Returns whether a presentation category participates in run-grouping — i.e.
 * whether a maximal run of consecutive calls of this category folds into one
 * collapsible chip. See {@link RUN_GROUPABLE_CATEGORIES} and `segmentToolCalls`.
 */
export function isRunGroupableCategory(category: ToolCategory): boolean {
  return RUN_GROUPABLE_CATEGORIES.has(category);
}

/**
 * Returns whether a category's primary argument is a file path — the file
 * tools (read / write / edit / delete). These render their path filename-first
 * via {@link FilePathLink} (full path on hover) in headers and previews, rather
 * than as a raw, often-absolute string.
 */
export function isFileCategory(category: ToolCategory): boolean {
  return (
    category === "read" ||
    category === "write" ||
    category === "edit" ||
    category === "delete"
  );
}

/** Resolved display metadata for a tool call, returned by {@link resolveToolCategory}. */
export interface ToolCategoryInfo {
  /** Semantic category of the tool. */
  readonly category: ToolCategory;
  /** Human-readable label for the tool (e.g., `"Shell"`, `"Read"`). */
  readonly label: string;
  /** JSON argument key that provides the primary display value (e.g., `"command"` for shell). */
  readonly primaryArgField: string;
  /** Fallback argument keys tried when the primary key is absent. */
  readonly fallbackArgFields: readonly string[];
  /**
   * JSON argument key carrying a model-authored intent phrase for this kind
   * (stigmer#276), or `undefined` for kinds without one. Shell is the only
   * carrier today: every harness converges on `description` — the Claude
   * harness's built-in shell tool ships it natively, and the Stigmer
   * harness's tool-intent middleware adds it to the `execute` schema at bind
   * time.
   */
  readonly intentArgField?: string;
}

interface KindDisplayEntry {
  readonly category: ToolCategory;
  readonly label: string;
  readonly primaryField: string;
  readonly fallbackFields?: readonly string[];
  readonly intentField?: string;
}

// Presentation metadata per ToolKind. Classification (name -> kind) is owned by
// @stigmer/client; this table only describes how each kind is shown. MCP and
// unknown are resolved dynamically (label derived from the tool name).
const KIND_DISPLAY: Partial<Record<ToolKind, KindDisplayEntry>> = {
  file_read:   { category: "read",      label: "Read",      primaryField: "path", fallbackFields: ["file_path", "file"] },
  file_write:  { category: "write",     label: "Write",     primaryField: "path", fallbackFields: ["file_path", "file", "filename"] },
  file_edit:   { category: "edit",      label: "Edit",      primaryField: "path", fallbackFields: ["file_path", "file", "filename"] },
  file_delete: { category: "delete",    label: "Delete",    primaryField: "path", fallbackFields: ["file_path", "file", "filename"] },
  shell:       { category: "shell",     label: "Shell",     primaryField: "command", intentField: "description" },
  search:      { category: "search",    label: "Search",    primaryField: "pattern", fallbackFields: ["query", "q"] },
  list:        { category: "list",      label: "List",      primaryField: "path" },
  fetch:       { category: "fetch",     label: "Fetch",     primaryField: "url", fallbackFields: ["uri"] },
  web_search:  { category: "web-search", label: "Web Search", primaryField: "query", fallbackFields: ["q", "search_term"] },
  think:       { category: "think",     label: "Thinking",  primaryField: "thought" },
  subagent:    { category: "subagent", label: "Subagent", primaryField: "description", fallbackFields: ["prompt"] },
  todo:        { category: "internal",  label: "Todos",     primaryField: "todos" },
  memory:      { category: "memory",    label: "Remember",  primaryField: "fact" },
  background_stop: { category: "background-stop", label: "Stop command", primaryField: "" },
  skill:       { category: "skill",     label: "Use skill", primaryField: "skill" },
};

/**
 * Returns true if the tool is an internal state-management tool that should not
 * appear in the message thread (todos are rendered through a dedicated surface).
 */
export function isInternalTool(toolName: string): boolean {
  return resolveToolKindByName(toolName) === "todo";
}

/** Maps a {@link ToolKind} to its presentation metadata. */
export function toolKindToCategoryInfo(
  kind: ToolKind,
  toolName: string,
): ToolCategoryInfo {
  const entry = KIND_DISPLAY[kind];
  if (entry) {
    return {
      category: entry.category,
      label: entry.label,
      primaryArgField: entry.primaryField,
      fallbackArgFields: entry.fallbackFields ?? [],
      ...(entry.intentField ? { intentArgField: entry.intentField } : {}),
    };
  }

  if (kind === "mcp") {
    return {
      category: "mcp",
      label: humanizeToolName(toolName),
      primaryArgField: "slug",
      fallbackArgFields: ["name", "org"],
    };
  }

  return {
    category: "unknown",
    label: humanizeToolName(toolName),
    primaryArgField: "",
    fallbackArgFields: [],
  };
}

/**
 * Resolves a tool's presentation category from its name + MCP slug.
 *
 * Classification is delegated to `@stigmer/client`'s name-based resolver (the same
 * table the runner and the CLI use), then mapped to presentation metadata. When
 * the caller holds the tool use, prefer {@link resolveToolCategoryFromCall}.
 */
export function resolveToolCategory(
  toolName: string,
  mcpServerSlug?: string,
): ToolCategoryInfo {
  return toolKindToCategoryInfo(
    resolveToolKindByName(toolName, mcpServerSlug),
    toolName,
  );
}

/**
 * {@link resolveToolCategory} for a tool use (its name and MCP server).
 */
export function resolveToolCategoryFromCall(toolUse: ToolIdentity): ToolCategoryInfo {
  return toolKindToCategoryInfo(resolveToolKind(toolUse), toolUse.name);
}

/**
 * Resolves presentation metadata from an explicit {@link ToolKind} plus the
 * tool name and MCP slug, for a surface that already holds the kind. Falls
 * back to name-based resolution when the kind is `unknown`.
 */
export function resolveToolCategoryFromKind(
  toolKind: ToolKind,
  toolName: string,
  mcpServerSlug?: string,
): ToolCategoryInfo {
  const kind =
    toolKind !== "unknown"
      ? toolKind
      : resolveToolKindByName(toolName, mcpServerSlug);
  return toolKindToCategoryInfo(kind, toolName);
}

/**
 * Converts a snake_case or camelCase tool name into a
 * human-readable title.
 *
 * @example
 * humanizeToolName("apply_mcp_server") // "Apply MCP Server"
 * humanizeToolName("deleteAgent")      // "Delete Agent"
 */
export function humanizeToolName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bMcp\b/gi, "MCP")
    .replace(/\bApi\b/gi, "API")
    .replace(/\bId\b/gi, "ID")
    .replace(/\bUrl\b/gi, "URL")
    .replace(/\bIam\b/gi, "IAM");
}

function extractArgValue(
  args: JsonObject | undefined,
  primary: string,
  fallbacks: readonly string[],
): string | null {
  if (!args) return null;

  const tryField = (field: string): string | null => {
    const val = args[field];
    if (typeof val === "string" && val.length > 0) return val;
    return null;
  };

  if (primary) {
    const v = tryField(primary);
    if (v) return v;
  }

  for (const fb of fallbacks) {
    const v = tryField(fb);
    if (v) return v;
  }

  return null;
}

/**
 * What a `task` call asked its subagent to do, in a few words: the call's
 * `description` input, or "" when it carries none.
 */
export function subagentSubjectOf(toolUse: Pick<ToolUse, "input">): string {
  const description = toolUse.input["description"];
  return typeof description === "string" ? description : "";
}

/**
 * Extracts the most relevant argument value from a tool use
 * based on its category (command for shell tools, path for file
 * tools, slug for MCP tools, etc.).
 *
 * Returns `null` when the tool has no recognised arguments.
 */
export function extractPrimaryArg(
  toolUse: Pick<ToolUse, "name" | "mcpServerName" | "input">,
): string | null {
  const info = resolveToolCategoryFromCall(toolUse);
  const result = extractArgValue(
    toolUse.input,
    info.primaryArgField,
    info.fallbackArgFields,
  );

  if (result) return result;

  // The first argument that is not a secret: a secret is never a row title
  // (stigmer#1119), and `[REDACTED]` would read as content.
  if (info.category === "unknown" || info.category === "mcp") {
    const first = Object.keys(toolUse.input).find((key) => !isSecretArgKey(key));
    if (first !== undefined) {
      const val = toolUse.input[first];
      if (typeof val === "string") return val;
    }
  }

  return null;
}

/**
 * Extracts the primary argument value from a JSON string (typically an
 * ask's `argsPreview`). Returns `null` if parsing fails or the expected field
 * is not found.
 *
 * When the caller already holds the tool's kind, pass it so resolution honors
 * the same kind that drives the label and icon. Falls back to name-based
 * resolution when the kind is `unknown`.
 */
export function extractPrimaryArgFromPreview(
  toolName: string,
  argsPreview: string,
  mcpServerSlug?: string,
  toolKind?: ToolKind,
): string | null {
  if (!argsPreview) return null;

  try {
    const parsed = JSON.parse(argsPreview);
    if (typeof parsed !== "object" || parsed === null) return null;

    const info =
      toolKind !== undefined
        ? resolveToolCategoryFromKind(toolKind, toolName, mcpServerSlug)
        : resolveToolCategory(toolName, mcpServerSlug);
    return extractArgValue(
      parsed as JsonObject,
      info.primaryArgField,
      info.fallbackArgFields,
    );
  } catch {
    return null;
  }
}

/**
 * Extracts the model-authored intent phrase from a tool call's args
 * (stigmer#276), or `null` when the kind carries none / the model omitted it.
 *
 * The intent is presentation metadata authored by the model *for the user* —
 * "Run unit tests for the parser" — rendered as the row title in place of the
 * bare category label. Extraction is kind-scoped via
 * {@link ToolCategoryInfo.intentArgField} (shell-only today) so a same-named
 * REAL argument on another kind (e.g. the subagent task tool's
 * `description`, which is its subject) is never misread as an intent.
 */
export function extractIntent(
  toolUse: Pick<ToolUse, "name" | "mcpServerName" | "input">,
): string | null {
  const info = resolveToolCategoryFromCall(toolUse);
  if (!info.intentArgField) return null;
  const value = toolUse.input[info.intentArgField];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * {@link extractIntent} for surfaces that carry a JSON `argsPreview` string
 * (an ask's sanitized preview) instead of the tool use's input. Same
 * kind-scoping; returns `null` on parse failure or when absent.
 */
export function extractIntentFromPreview(
  toolName: string,
  argsPreview: string,
  mcpServerSlug?: string,
  toolKind?: ToolKind,
): string | null {
  if (!argsPreview) return null;

  const info =
    toolKind !== undefined
      ? resolveToolCategoryFromKind(toolKind, toolName, mcpServerSlug)
      : resolveToolCategory(toolName, mcpServerSlug);
  if (!info.intentArgField) return null;

  try {
    const parsed = JSON.parse(argsPreview);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = (parsed as Record<string, unknown>)[info.intentArgField];
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

// Intent-title extraction lives in @stigmer/client's tool-view module — the
// cross-surface single source of truth the intent-title.json fixture pins —
// so React, Ink, and the CLI's headless renderers share one implementation.
// Re-exported here because this module is where React's public tool-view API
// surfaced them first (#677).
export { SHELL_INTENT_ARG_FIELD, extractShellIntent } from "@stigmer/client";

/**
 * Preview-string twin of {@link extractShellIntent} for surfaces that carry an
 * ask's JSON `argsPreview` instead of the tool use's input; mirrors
 * `extractPrimaryArgFromPreview`'s kind resolution.
 */
export function extractShellIntentFromPreview(
  toolName: string,
  argsPreview: string,
  mcpServerSlug?: string,
  toolKind?: ToolKind,
): string | null {
  if (!argsPreview) return null;

  const kind =
    toolKind !== undefined && toolKind !== "unknown"
      ? toolKind
      : resolveToolKindByName(toolName, mcpServerSlug);
  if (kind !== "shell") return null;

  try {
    const parsed = JSON.parse(argsPreview);
    if (typeof parsed !== "object" || parsed === null) return null;
    return shellIntentFromArgs(kind, parsed as JsonObject);
  } catch {
    return null;
  }
}

/**
 * The argument fields under which a write or edit tool carries the content it
 * proposes, in the order they are tried. One list for every reader — the
 * pre-execution gate ({@link ApprovalCardBody}) and the post-execution row
 * ({@link ToolArgsView}) — so the two never disagree on what "the content" is.
 * Spans every harness's file-tool shapes (deepagents' and Claude's
 * `content`/`new_string`).
 */
const WRITE_CONTENT_FIELDS = [
  "content",
  "file_content",
  "new_string",
  "replacement",
] as const;

/** A proposed write's content and the argument field it was found under. */
interface WriteContent {
  readonly field: (typeof WRITE_CONTENT_FIELDS)[number];
  readonly value: string;
}

/**
 * Finds the content a write/edit tool proposes in its parsed arguments: the
 * first {@link WRITE_CONTENT_FIELDS} entry holding a non-empty string, with the
 * field it sat under. `null` when the args carry no content.
 */
function findWriteContent(
  args: Record<string, unknown>,
): WriteContent | null {
  for (const field of WRITE_CONTENT_FIELDS) {
    const value = args[field];
    if (typeof value === "string" && value.length > 0) return { field, value };
  }
  return null;
}

/**
 * The content a write/edit tool proposes, from its parsed arguments, or `null`.
 * The value half of {@link findWriteContent}.
 */
export function extractWriteContentFromArgs(
  args: Record<string, unknown>,
): string | null {
  return findWriteContent(args)?.value ?? null;
}

/**
 * Parses a JSON `argsPreview` string into an args object, or `null` when the
 * string is empty, unparseable, or not an object. The preview is the runner's
 * sanitized summary of a tool call's arguments — secrets redacted, a value too
 * large to carry whole left out, paths and commands kept verbatim — so what
 * this returns is what a surface may SHOW; the proposed content of a write is
 * read from the row's `args` (see {@link withAuthoritativeWriteContent}).
 */
export function parseArgsPreview(
  argsPreview: string,
): Record<string, unknown> | null {
  if (!argsPreview) return null;
  try {
    const parsed: unknown = JSON.parse(argsPreview);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The preview-parsed args of a gated tool call with the proposed write content
 * taken from the row's authoritative `args` — and only that.
 *
 * A tool row carries two projections of its arguments: `args`, the full
 * arguments, and `args_preview`, the runner's sanitized summary (secrets
 * redacted, oversized values left out, paths and commands kept whole). The
 * summary is the right thing to *show* for every field but one: the content a
 * write or edit proposes, which is exactly the value the summary cannot carry
 * and exactly what the user is asked to approve. So the gate renders the
 * preview's fields and overlays the content from `args`, under the field
 * `args` carries it in. Nothing else crosses over — a field the runner
 * redacted in the preview stays redacted here.
 *
 * Returns `previewArgs` itself when `args` carries no content (nothing to
 * overlay) so memoized consumers keep their reference.
 */
export function withAuthoritativeWriteContent(
  previewArgs: Record<string, unknown>,
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const content = args ? findWriteContent(args) : null;
  if (!content) return previewArgs;
  return { ...previewArgs, [content.field]: content.value };
}
