"use client";

import { useMemo, useState } from "react";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { cn } from "@stigmer/theme";
import { formatDuration } from "./ToolCallDetail.js";
import { humanizeToolName } from "./tool-categories.js";
import {
  CollapsiblePre,
  CollapsibleJsonBlock,
  McpServerIcon,
  formatJson,
  isScalar,
  humanizeArgKey,
} from "./tool-rendering-primitives.js";
import { execIdFromStorageKey } from "./useFileChangeContent.js";
import { useArtifactDownloadUrl } from "./useArtifactDownloadUrl.js";
import { useArtifactDownload } from "./useArtifactDownload.js";
import { useToolOutputContent } from "./useToolOutputContent.js";

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
    <div className={cn("stg:space-y-3 stg:text-xs", className)}>
      <McpMetadataRow
        mcpServerSlug={toolCall.mcpServerSlug}
        toolName={toolCall.name}
        duration={duration}
      />

      {toolCall.args && Object.keys(toolCall.args).length > 0 && (
        <McpArgsView args={toolCall.args as Record<string, unknown>} />
      )}

      {toolCall.outputRef?.storageKey ? (
        <McpOffloadedOutputView outputRef={toolCall.outputRef} />
      ) : (
        toolCall.result && <McpResultView result={toolCall.result} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Offloaded output (ToolCallOutputRef)
// ---------------------------------------------------------------------------

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * Renders an MCP result whose bytes were offloaded to artifact storage (e.g. a
 * computer-use screenshot). The bytes are resolved on demand from the stable
 * `storageKey` — never from a baked URL, which expires. Images render inline via
 * a freshly minted URL; other large output expands in-app. Mirrors ResultView's
 * outputRef treatment so MCP and non-MCP offloads look consistent (DD-016).
 */
function McpOffloadedOutputView({
  outputRef,
}: {
  readonly outputRef: NonNullable<ToolCall["outputRef"]>;
}) {
  return (
    <div className="stg:space-y-1">
      <span className="stg:font-medium stg:text-muted-foreground">Result</span>
      {outputRef.isImage ? (
        <McpOffloadedImage storageKey={outputRef.storageKey} />
      ) : (
        <McpOffloadedText outputRef={outputRef} />
      )}
    </div>
  );
}

/** Offloaded MCP image output, rendered from an always-fresh presigned URL. */
function McpOffloadedImage({ storageKey }: { readonly storageKey: string }) {
  const executionId = useMemo(() => execIdFromStorageKey(storageKey), [storageKey]);
  const { url, error } = useArtifactDownloadUrl(executionId, storageKey);

  if (error) {
    return <p className="stg:text-xs stg:text-destructive">Couldn&apos;t load image output.</p>;
  }
  if (!url) {
    return (
      <div
        className="stg:h-40 stg:w-64 stg:animate-pulse stg:rounded-md stg:border stg:border-border stg:bg-muted"
        aria-busy="true"
        aria-label="Loading image output"
      />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="stg:inline-block stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
    >
      <img
        src={url}
        alt="Tool output screenshot"
        loading="lazy"
        className="stg:max-h-96 stg:w-auto stg:rounded-md stg:border stg:border-border"
      />
    </a>
  );
}

/**
 * Offloaded MCP text output. Preview head + a "View full output" toggle that
 * lazily fetches the full content in-app, with a download fallback when the
 * server truncates it.
 */
function McpOffloadedText({
  outputRef,
}: {
  readonly outputRef: NonNullable<ToolCall["outputRef"]>;
}) {
  const [expanded, setExpanded] = useState(false);
  const executionId = useMemo(() => execIdFromStorageKey(outputRef.storageKey), [outputRef.storageKey]);
  const { content, isLoading, isTruncated, error } = useToolOutputContent(outputRef, expanded);
  const { download, isDownloading } = useArtifactDownload(executionId);

  const size = Number(outputRef.sizeBytes);
  const sizeSuffix = size ? ` (${formatBytes(size)})` : "";
  const previewClass = "stg:max-h-80 stg:overflow-auto stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:p-2 stg:text-foreground";
  const linkClass = "stg:inline-block stg:text-xs stg:font-medium stg:text-primary stg:underline-offset-2 stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring";

  return (
    <div className="stg:space-y-1">
      {!expanded ? (
        <>
          {outputRef.truncatedPreview && (
            <CollapsiblePre content={outputRef.truncatedPreview} className={previewClass} />
          )}
          <button type="button" onClick={() => setExpanded(true)} className={linkClass}>
            View full output{sizeSuffix}
          </button>
        </>
      ) : isLoading ? (
        <p className="stg:text-xs stg:text-muted-foreground">Loading full output…</p>
      ) : error ? (
        <p className="stg:text-xs stg:text-destructive">Couldn&apos;t load full output. Try again.</p>
      ) : content !== null ? (
        <div className="stg:space-y-1">
          <CollapsiblePre content={content} className={previewClass} />
          {isTruncated && (
            <button
              type="button"
              onClick={() => download(outputRef.storageKey)}
              disabled={isDownloading}
              className={cn(linkClass, "stg:disabled:opacity-50")}
            >
              {isDownloading ? "Preparing download…" : `Output truncated — download full file${sizeSuffix}`}
            </button>
          )}
        </div>
      ) : null}
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
    <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-x-3 stg:gap-y-1 stg:text-muted-foreground">
      {mcpServerSlug && (
        <span className="stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono">
          <McpServerIcon />
          {mcpServerSlug}
          <span className="stg:text-muted-foreground-subtle">/</span>
          <span className="stg:text-foreground">{humanizeToolName(toolName)}</span>
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
    <div className="stg:space-y-2">
      <span className="stg:font-medium stg:text-muted-foreground">Arguments</span>

      {scalars.length > 0 && (
        <dl className="stg:grid stg:grid-cols-[auto_1fr] stg:gap-x-3 stg:gap-y-1 stg:rounded-md stg:border stg:border-border stg:bg-muted-faint stg:px-2.5 stg:py-2">
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
      <dt className="stg:whitespace-nowrap stg:font-mono stg:text-muted-foreground">
        {humanizeArgKey(label)}
      </dt>
      {isMultiline ? (
        <dd className="stg:min-w-0">
          <pre className="stg:whitespace-pre-wrap stg:break-words stg:rounded stg:border stg:border-border stg:bg-muted-subtle stg:px-2 stg:py-1 stg:font-mono stg:text-foreground">
            {value}
          </pre>
        </dd>
      ) : (
        <dd className="stg:min-w-0 stg:truncate stg:font-mono stg:text-foreground" title={value}>
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
    <div className="stg:space-y-1">
      <span className="stg:font-medium stg:text-muted-foreground">Result</span>
      <CollapsiblePre
        content={parsed}
        className="stg:max-h-80 stg:overflow-auto stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:p-2 stg:text-foreground"
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

