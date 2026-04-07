"use client";

import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { cn } from "@stigmer/theme";
import { formatDuration } from "./ToolCallDetail";
import { humanizeToolName } from "./tool-categories";
import {
  CollapsiblePre,
  CollapsibleJsonBlock,
  McpServerIcon,
  formatJson,
  isScalar,
  humanizeArgKey,
} from "./tool-rendering-primitives";

/** Props for {@link McpToolDetail}. */
export interface McpToolDetailProps {
  /** The MCP tool call to render with structured formatting. */
  readonly toolCall: ToolCall;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * MCP-aware detail renderer for tool calls originating from an MCP
 * server.
 *
 * Replaces the generic "dump args + result as raw JSON" fallback
 * with structured formatting:
 *
 * - **Arguments** are rendered as a labelled key-value list.
 *   Scalars display inline; objects/arrays collapse into formatted
 *   JSON blocks.
 * - **Results** are parsed through {@link parseMcpResult} which
 *   handles MCP content-block arrays, embedded JSON, and Python
 *   repr artefacts before rendering.
 *
 * @example
 * ```tsx
 * <McpToolDetail toolCall={toolCall} />
 * ```
 */
export function McpToolDetail({ toolCall, className }: McpToolDetailProps) {
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);

  return (
    <div className={cn("space-y-3 text-xs", className)}>
      <McpMetadataRow
        mcpServerSlug={toolCall.mcpServerSlug}
        toolName={toolCall.name}
        duration={duration}
      />

      {toolCall.args && Object.keys(toolCall.args).length > 0 && (
        <McpArgsView args={toolCall.args as Record<string, unknown>} />
      )}

      {toolCall.result && (
        <McpResultView result={toolCall.result} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/** Props for {@link McpMetadataRow}. */
export interface McpMetadataRowProps {
  /** Slug of the MCP server that owns the tool. */
  readonly mcpServerSlug: string;
  /** Name of the tool that was invoked. */
  readonly toolName: string;
  /** Human-readable execution duration, or `null` if still running. */
  readonly duration: string | null;
}

/**
 * Displays MCP server slug, tool name, and optional duration as a
 * compact metadata row above tool arguments.
 */
export function McpMetadataRow({
  mcpServerSlug,
  toolName,
  duration,
}: McpMetadataRowProps) {
  const hasMetadata = mcpServerSlug || duration;
  if (!hasMetadata) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
      {mcpServerSlug && (
        <span className="inline-flex items-center gap-1.5 rounded bg-muted px-1.5 py-0.5 font-mono">
          <McpServerIcon />
          {mcpServerSlug}
          <span className="text-muted-foreground/60">/</span>
          <span className="text-foreground">{humanizeToolName(toolName)}</span>
        </span>
      )}
      {duration && <span>{duration}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arguments — structured key-value rendering
// ---------------------------------------------------------------------------

/** Props for {@link McpArgsView}. */
export interface McpArgsViewProps {
  /** Tool argument map to render as a key-value list. */
  readonly args: Record<string, unknown>;
}

/**
 * Renders MCP tool arguments as a structured key-value list.
 *
 * Scalars display inline; objects and arrays collapse into
 * formatted JSON blocks via {@link CollapsibleJsonBlock}.
 */
export function McpArgsView({ args }: McpArgsViewProps) {
  const entries = Object.entries(args);
  if (entries.length === 0) return null;

  const scalars: [string, string][] = [];
  const complex: [string, unknown][] = [];

  for (const [key, value] of entries) {
    if (isScalar(value)) {
      scalars.push([key, String(value)]);
    } else {
      complex.push([key, value]);
    }
  }

  return (
    <div className="space-y-2">
      <span className="font-medium text-muted-foreground">Arguments</span>

      {scalars.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border bg-muted/30 px-2.5 py-2">
          {scalars.map(([key, value]) => (
            <ScalarRow key={key} label={key} value={value} />
          ))}
        </dl>
      )}

      {complex.map(([key, value]) => (
        <CollapsibleJsonBlock
          key={key}
          label={humanizeArgKey(key)}
          content={formatJson(value)}
        />
      ))}
    </div>
  );
}

function ScalarRow({ label, value }: { label: string; value: string }) {
  const isMultiline = value.includes("\n");

  return (
    <>
      <dt className="whitespace-nowrap font-mono text-muted-foreground">
        {humanizeArgKey(label)}
      </dt>
      {isMultiline ? (
        <dd className="min-w-0">
          <pre className="whitespace-pre-wrap break-words rounded border border-border bg-muted/40 px-2 py-1 font-mono text-foreground">
            {value}
          </pre>
        </dd>
      ) : (
        <dd className="min-w-0 truncate font-mono text-foreground" title={value}>
          {value}
        </dd>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Result — intelligent parsing
// ---------------------------------------------------------------------------

function McpResultView({ result }: { result: string }) {
  const parsed = parseMcpResult(result);

  return (
    <div className="space-y-1">
      <span className="font-medium text-muted-foreground">Result</span>
      <CollapsiblePre
        content={parsed}
        className="max-h-80 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-foreground"
      />
    </div>
  );
}

/**
 * Extracts human-readable content from an MCP tool result string.
 *
 * Handles three common formats that arrive from the backend:
 *
 * 1. **MCP content-block array** — `[{"type":"text","text":"..."}]`.
 *    Text parts are extracted and, if they are themselves valid
 *    JSON, pretty-printed.
 * 2. **Python repr** — `[{'type': 'text', 'text': '...'}]`. Single
 *    quotes are normalised to double quotes before parsing.
 * 3. **Plain JSON / text** — returned formatted when valid JSON,
 *    or as-is otherwise.
 */
export function parseMcpResult(result: string): string {
  const trimmed = result.trim();

  // Fast path: try standard JSON parse first.
  const jsonParsed = tryParseJson(trimmed);
  if (jsonParsed !== undefined) {
    const extracted = tryExtractContentBlocks(jsonParsed);
    if (extracted !== null) return extracted;
    return JSON.stringify(jsonParsed, null, 2);
  }

  // Attempt to fix Python repr (single-quoted dicts/lists).
  const fixed = tryFixPythonRepr(trimmed);
  if (fixed !== undefined) {
    const extracted = tryExtractContentBlocks(fixed);
    if (extracted !== null) return extracted;
    return JSON.stringify(fixed, null, 2);
  }

  return trimmed;
}

// ---------------------------------------------------------------------------
// Content-block extraction
// ---------------------------------------------------------------------------

interface McpContentBlock {
  type: string;
  text?: string;
}

function isMcpContentBlockArray(val: unknown): val is McpContentBlock[] {
  if (!Array.isArray(val)) return false;
  if (val.length === 0) return false;
  return val.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      typeof (item as Record<string, unknown>).type === "string",
  );
}

function tryExtractContentBlocks(parsed: unknown): string | null {
  if (!isMcpContentBlockArray(parsed)) return null;

  const textParts: string[] = [];
  for (const block of parsed) {
    if (block.type === "text" && typeof block.text === "string") {
      const innerJson = tryParseJson(block.text.trim());
      if (innerJson !== undefined) {
        textParts.push(JSON.stringify(innerJson, null, 2));
      } else {
        textParts.push(block.text);
      }
    }
  }

  return textParts.length > 0 ? textParts.join("\n\n") : null;
}

// ---------------------------------------------------------------------------
// JSON / Python repr helpers
// ---------------------------------------------------------------------------

function tryParseJson(str: string): unknown | undefined {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

/**
 * Attempts to convert a Python repr string (single-quoted
 * dicts/lists with True/False/None) into a parsed JS value.
 *
 * This is intentionally conservative: it only handles the
 * most common patterns and bails on ambiguity.
 */
function tryFixPythonRepr(str: string): unknown | undefined {
  if (!str.startsWith("[") && !str.startsWith("{")) return undefined;

  let fixed = str
    .replace(/'/g, '"')
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");

  // Handle trailing commas before ] or } (common in Python repr).
  fixed = fixed.replace(/,\s*([}\]])/g, "$1");

  return tryParseJson(fixed);
}

