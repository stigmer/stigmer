import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import { ToolKind, resolveToolKind, resolveToolKindByName } from "@stigmer/sdk";

/**
 * Discriminated tool categories for type-aware rendering.
 *
 * This is the presentation taxonomy. Classification (name -> kind) lives in
 * `@stigmer/sdk`'s `resolveToolKind` (single source of truth, shared with the
 * runner and Go CLI); this file maps each {@link ToolKind} to its presentation
 * metadata (label, primary argument). `"mcp"` covers tools originating from an
 * MCP server, whose names are dynamic.
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
  | "sub-agent"
  | "internal"
  | "mcp"
  | "unknown";

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
}

interface KindDisplayEntry {
  readonly category: ToolCategory;
  readonly label: string;
  readonly primaryField: string;
  readonly fallbackFields?: readonly string[];
}

// Presentation metadata per ToolKind. Classification (name -> kind) is owned by
// @stigmer/sdk; this table only describes how each kind is shown. MCP and
// unknown are resolved dynamically (label derived from the tool name).
const KIND_DISPLAY: Partial<Record<ToolKind, KindDisplayEntry>> = {
  [ToolKind.FILE_READ]:   { category: "read",      label: "Read",      primaryField: "path", fallbackFields: ["file_path", "file"] },
  [ToolKind.FILE_WRITE]:  { category: "write",     label: "Write",     primaryField: "path", fallbackFields: ["file_path", "file", "filename"] },
  [ToolKind.FILE_EDIT]:   { category: "edit",      label: "Edit",      primaryField: "path", fallbackFields: ["file_path", "file", "filename"] },
  [ToolKind.FILE_DELETE]: { category: "delete",    label: "Delete",    primaryField: "path", fallbackFields: ["file_path", "file", "filename"] },
  [ToolKind.SHELL]:       { category: "shell",     label: "Shell",     primaryField: "command" },
  [ToolKind.SEARCH]:      { category: "search",    label: "Search",    primaryField: "pattern", fallbackFields: ["query", "q"] },
  [ToolKind.LIST]:        { category: "list",      label: "List",      primaryField: "path" },
  [ToolKind.FETCH]:       { category: "fetch",     label: "Fetch",     primaryField: "url", fallbackFields: ["uri"] },
  [ToolKind.WEB_SEARCH]:  { category: "web-search", label: "Web Search", primaryField: "query", fallbackFields: ["q", "search_term"] },
  [ToolKind.THINK]:       { category: "think",     label: "Thinking",  primaryField: "thought" },
  [ToolKind.SUBAGENT]:    { category: "sub-agent", label: "Sub-agent", primaryField: "description", fallbackFields: ["prompt"] },
  [ToolKind.TODO]:        { category: "internal",  label: "Todos",     primaryField: "todos" },
};

/**
 * Returns true if the tool is an internal state-management tool that should not
 * appear in the message thread (todos are rendered through a dedicated surface).
 */
export function isInternalTool(toolName: string): boolean {
  return resolveToolKindByName(toolName) === ToolKind.TODO;
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
    };
  }

  if (kind === ToolKind.MCP) {
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
 * Classification is delegated to `@stigmer/sdk`'s name-based resolver (the same
 * table the runner and Go CLI use), then mapped to presentation metadata. When
 * the caller has the full {@link ToolCall}, prefer {@link resolveToolCategoryFromCall},
 * which also honours the wire `tool_kind` for forward compatibility.
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
 * Like {@link resolveToolCategory} but uses the wire `tool_kind` when present,
 * falling back to name-based resolution for legacy executions.
 */
export function resolveToolCategoryFromCall(toolCall: ToolCall): ToolCategoryInfo {
  return toolKindToCategoryInfo(resolveToolKind(toolCall), toolCall.name);
}

/**
 * Resolves presentation metadata from an explicit wire {@link ToolKind} plus the
 * tool name and MCP slug. Used by surfaces that carry a denormalized `tool_kind`
 * but not a full {@link ToolCall} — notably `PendingApproval`. Falls back to
 * name-based resolution when the kind is unset (legacy executions).
 */
export function resolveToolCategoryFromKind(
  toolKind: ToolKind,
  toolName: string,
  mcpServerSlug?: string,
): ToolCategoryInfo {
  const kind =
    toolKind !== ToolKind.UNSPECIFIED
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
 * Extracts the most relevant argument value from a tool call
 * based on its category (command for shell tools, path for file
 * tools, slug for MCP tools, etc.).
 *
 * Returns `null` when the tool has no recognised arguments.
 */
export function extractPrimaryArg(toolCall: ToolCall): string | null {
  const info = resolveToolCategoryFromCall(toolCall);
  const result = extractArgValue(
    toolCall.args,
    info.primaryArgField,
    info.fallbackArgFields,
  );

  if (result) return result;

  if ((info.category === "unknown" || info.category === "mcp") && toolCall.args) {
    const keys = Object.keys(toolCall.args);
    if (keys.length > 0) {
      const val = toolCall.args[keys[0]];
      if (typeof val === "string") return val;
    }
  }

  return null;
}

/**
 * Extracts the primary argument value from a JSON string
 * (typically `PendingApproval.argsPreview`). Returns `null` if
 * parsing fails or the expected field is not found.
 */
export function extractPrimaryArgFromPreview(
  toolName: string,
  argsPreview: string,
  mcpServerSlug?: string,
): string | null {
  if (!argsPreview) return null;

  try {
    const parsed = JSON.parse(argsPreview);
    if (typeof parsed !== "object" || parsed === null) return null;

    const info = resolveToolCategory(toolName, mcpServerSlug);
    return extractArgValue(
      parsed as JsonObject,
      info.primaryArgField,
      info.fallbackArgFields,
    );
  } catch {
    return null;
  }
}

const WRITE_CONTENT_FIELDS = [
  "contents",
  "content",
  "file_content",
  "new_text",
  "new_string",
  "replacement",
] as const;

/**
 * Extracts the file content body from a JSON `argsPreview` string
 * for write/edit tool categories. Scans the same field names used
 * by the post-execution {@link ToolCallDetail} renderer so that
 * the approval preview matches the completed tool call display.
 *
 * Returns `null` if parsing fails or no content field is found.
 */
export function extractWriteContentFromPreview(
  argsPreview: string,
): string | null {
  if (!argsPreview) return null;

  try {
    const parsed = JSON.parse(argsPreview);
    if (typeof parsed !== "object" || parsed === null) return null;

    for (const field of WRITE_CONTENT_FIELDS) {
      const val = (parsed as Record<string, unknown>)[field];
      if (typeof val === "string" && val.length > 0) return val;
    }
    return null;
  } catch {
    return null;
  }
}
