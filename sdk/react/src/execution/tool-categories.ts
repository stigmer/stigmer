import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { JsonObject } from "@bufbuild/protobuf";

/**
 * Discriminated tool categories for type-aware rendering.
 *
 * Mirrors the CLI's `toolDisplayMap` in
 * `client-apps/cli/pkg/toolrender/render.go`.
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
  | "unknown";

export interface ToolCategoryInfo {
  readonly category: ToolCategory;
  readonly label: string;
  readonly primaryArgField: string;
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
]);

/**
 * Resolves a tool name to its category metadata for type-aware
 * rendering. Returns a stable `"unknown"` entry for unrecognized
 * tools using the raw tool name as the label.
 */
export function resolveToolCategory(toolName: string): ToolCategoryInfo {
  const entry = TOOL_DISPLAY_MAP.get(toolName);
  if (entry) {
    return {
      category: entry.category,
      label: entry.label,
      primaryArgField: entry.primaryField,
      fallbackArgFields: entry.fallbackFields ?? [],
    };
  }
  return {
    category: "unknown",
    label: toolName,
    primaryArgField: "",
    fallbackArgFields: [],
  };
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
 * tools, pattern for search tools, etc.).
 *
 * Returns `null` when the tool is unknown and has no arguments,
 * or when the expected argument fields are missing.
 */
export function extractPrimaryArg(toolCall: ToolCall): string | null {
  const info = resolveToolCategory(toolCall.name);
  const result = extractArgValue(
    toolCall.args,
    info.primaryArgField,
    info.fallbackArgFields,
  );

  if (result) return result;

  if (info.category === "unknown" && toolCall.args) {
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
): string | null {
  if (!argsPreview) return null;

  try {
    const parsed = JSON.parse(argsPreview);
    if (typeof parsed !== "object" || parsed === null) return null;

    const info = resolveToolCategory(toolName);
    return extractArgValue(
      parsed as JsonObject,
      info.primaryArgField,
      info.fallbackArgFields,
    );
  } catch {
    return null;
  }
}
