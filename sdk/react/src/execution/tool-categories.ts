import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { JsonObject } from "@bufbuild/protobuf";

/**
 * Discriminated tool categories for type-aware rendering.
 *
 * Mirrors the CLI's `toolDisplayMap` in
 * `client-apps/cli/pkg/toolrender/render.go`.
 *
 * `"mcp"` covers tools originating from an MCP server whose
 * names are dynamic and cannot be statically listed in
 * {@link TOOL_DISPLAY_MAP}.
 */
export type ToolCategory =
  | "shell"
  | "read"
  | "write"
  | "edit"
  | "delete"
  | "search"
  | "list"
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

interface ToolDisplayEntry {
  readonly category: ToolCategory;
  readonly label: string;
  readonly primaryField: string;
  readonly fallbackFields?: readonly string[];
}

const TOOL_DISPLAY_MAP: ReadonlyMap<string, ToolDisplayEntry> = new Map([
  ["shell",           { category: "shell",     label: "Shell",     primaryField: "command" }],
  ["bash",            { category: "shell",     label: "Shell",     primaryField: "command" }],
  ["execute",         { category: "shell",     label: "Execute",   primaryField: "command" }],
  ["execute_command", { category: "shell",     label: "Shell",     primaryField: "command" }],
  ["run_command",     { category: "shell",     label: "Shell",     primaryField: "command" }],
  ["terminal",        { category: "shell",     label: "Shell",     primaryField: "command" }],

  ["read",            { category: "read",      label: "Read",      primaryField: "path",    fallbackFields: ["file_path", "file"] }],
  ["read_file",       { category: "read",      label: "Read",      primaryField: "path",    fallbackFields: ["file_path", "file"] }],

  ["write",           { category: "write",     label: "Write",     primaryField: "path",    fallbackFields: ["file_path", "file", "filename"] }],
  ["write_file",      { category: "write",     label: "Write",     primaryField: "path",    fallbackFields: ["file_path", "file", "filename"] }],
  ["create_file",     { category: "write",     label: "Create",    primaryField: "path",    fallbackFields: ["file_path", "file", "filename"] }],
  ["overwrite_file",  { category: "write",     label: "Write",     primaryField: "path",    fallbackFields: ["file_path", "file", "filename"] }],

  ["edit",            { category: "edit",      label: "Edit",      primaryField: "path",    fallbackFields: ["file_path", "file", "filename"] }],
  ["edit_file",       { category: "edit",      label: "Edit",      primaryField: "path",    fallbackFields: ["file_path", "file", "filename"] }],

  ["delete_file",     { category: "delete",    label: "Delete",    primaryField: "path",    fallbackFields: ["file_path", "file", "filename"] }],
  ["remove_file",     { category: "delete",    label: "Delete",    primaryField: "path",    fallbackFields: ["file_path", "file", "filename"] }],

  ["glob",            { category: "search",    label: "Find",      primaryField: "pattern" }],
  ["grep",            { category: "search",    label: "Search",    primaryField: "pattern" }],

  ["list_directory",  { category: "list",      label: "List",      primaryField: "path" }],
  ["ls",              { category: "list",      label: "List",      primaryField: "path" }],

  ["think",           { category: "think",     label: "Thinking",  primaryField: "thought" }],

  ["task",            { category: "sub-agent", label: "Sub-agent", primaryField: "description", fallbackFields: ["prompt"] }],

  ["updateTodos",     { category: "internal",  label: "Todos",     primaryField: "todos" }],
  ["TodoWrite",       { category: "internal",  label: "Todos",     primaryField: "todos" }],
  ["write_todos",     { category: "internal",  label: "Todos",     primaryField: "todos" }],
]);

/**
 * Resolves a tool name to its category metadata for type-aware
 * rendering.
 *
 * When `mcpServerSlug` is provided and the tool name is not a
 * known built-in, the tool is categorised as `"mcp"` with a
 * human-readable label derived from the raw tool name.
 *
 * Falls back to `"unknown"` only when the tool is neither
 * built-in nor MCP-originated.
 */
/**
 * Returns true if the tool is an internal state management tool that
 * should not be displayed in the message thread. Internal tools are
 * rendered through dedicated UX surfaces (e.g. TodoList sidebar)
 * rather than as expandable tool call items.
 */
export function isInternalTool(toolName: string): boolean {
  const entry = TOOL_DISPLAY_MAP.get(toolName);
  return entry?.category === "internal";
}

export function resolveToolCategory(
  toolName: string,
  mcpServerSlug?: string,
): ToolCategoryInfo {
  const entry = TOOL_DISPLAY_MAP.get(toolName);
  if (entry) {
    return {
      category: entry.category,
      label: entry.label,
      primaryArgField: entry.primaryField,
      fallbackArgFields: entry.fallbackFields ?? [],
    };
  }

  if (mcpServerSlug) {
    return {
      category: "mcp",
      label: humanizeToolName(toolName),
      primaryArgField: "slug",
      fallbackArgFields: ["name", "org"],
    };
  }

  return {
    category: "unknown",
    label: toolName,
    primaryArgField: "",
    fallbackArgFields: [],
  };
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
  const info = resolveToolCategory(toolCall.name, toolCall.mcpServerSlug);
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
