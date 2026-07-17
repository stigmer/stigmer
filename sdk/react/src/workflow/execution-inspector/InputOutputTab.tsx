"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { JsonObject } from "@bufbuild/protobuf";
import type { TaskDetailIO } from "../task-detail/task-detail-io.js";
import { formatJson } from "../../execution/tool-rendering-primitives.js";
import { StructuredDataViewer } from "../task-detail/StructuredDataViewer.js";

type ViewMode = "structured" | "json";

const COPIED_FEEDBACK_MS = 2000;

export interface InputOutputTabProps {
  readonly data: TaskDetailIO | null;
  readonly label: "Input" | "Output";
  readonly className?: string;
}

/**
 * Renders task input or output data with a structured/JSON view toggle
 * and copy/download actions.
 *
 * Default view is the {@link StructuredDataViewer} which renders data
 * as human-readable key-value pairs following the `McpArgsView` pattern.
 * Users can toggle to a syntax-highlighted raw JSON view for debugging.
 *
 * Copy and Download buttons follow the {@link ArtifactPreviewModal}
 * interaction pattern: clipboard copy with brief feedback, and
 * browser-triggered file download.
 */
export const InputOutputTab = memo(function InputOutputTab({
  data,
  label,
  className,
}: InputOutputTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("structured");
  const [copied, setCopied] = useState(false);

  const jsonContent = useMemo(
    () => (data ? formatJson(data.data) : ""),
    [data],
  );

  const handleCopy = useCallback(() => {
    if (!jsonContent) return;
    copyToClipboard(jsonContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    });
  }, [jsonContent]);

  const handleDownload = useCallback(() => {
    if (!jsonContent) return;
    downloadFile(jsonContent, `${label.toLowerCase()}.json`, "application/json");
  }, [jsonContent, label]);

  if (!data) {
    return (
      <div className={cn("flex flex-col items-center justify-center px-4 py-8 text-center", className)}>
        <EmptyDataIcon />
        <p className="mt-2 text-xs text-muted-foreground">
          {label} data not available for this execution
        </p>
        {label === "Input" && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            The workflow runner may not have recorded task inputs for this run.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Toolbar: view toggle + actions */}
      <div className="flex items-center justify-between">
        <div
          className="inline-flex rounded-md bg-muted p-0.5"
          role="tablist"
          aria-label={`${label} view mode`}
        >
          <ViewToggleButton
            active={viewMode === "structured"}
            onClick={() => setViewMode("structured")}
            label="Structured"
          />
          <ViewToggleButton
            active={viewMode === "json"}
            onClick={() => setViewMode("json")}
            label="JSON"
          />
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Copied to clipboard" : `Copy ${label.toLowerCase()} as JSON`}
            className={cn(
              "inline-flex items-center justify-center rounded-sm p-1.5 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              copied
                ? "text-success"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            aria-label={`Download ${label.toLowerCase()} as JSON file`}
            className={cn(
              "inline-flex items-center justify-center rounded-sm p-1.5 transition-colors",
              "text-muted-foreground hover:text-foreground hover:bg-muted",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <DownloadIcon />
          </button>
        </div>
      </div>

      {/* Banners */}
      {data.source === "event-summary" && (
        <p className="text-[10px] text-muted-foreground">
          Showing truncated summary from the event log. Full data will be available when the runner is updated.
        </p>
      )}
      {data.artifactIds.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {data.artifactIds.length} artifact{data.artifactIds.length > 1 ? "s" : ""} associated
        </p>
      )}

      {/* Content */}
      {viewMode === "structured" ? (
        <StructuredDataViewer data={data.data as JsonObject} />
      ) : (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted-subtle p-2.5 font-mono text-xs leading-relaxed text-foreground">
          <code>{highlightJson(jsonContent)}</code>
        </pre>
      )}

      {/* Screen reader clipboard feedback */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {copied && "Content copied to clipboard"}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// View toggle button (follows ArtifactContentRenderer.TabButton pattern)
// ---------------------------------------------------------------------------

function ViewToggleButton({
  active,
  onClick,
  label,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// JSON syntax highlighting (follows ArtifactContentRenderer.highlightJson)
// ---------------------------------------------------------------------------

function highlightJson(content: string): React.ReactNode {
  return content.split("\n").map((line, i) => {
    const keyMatch = line.match(/^(\s*)"([^"]+)"(\s*:)(.*)/);
    if (keyMatch) {
      const [, indent, key, colon, rest] = keyMatch;
      return (
        <span key={i}>
          {i > 0 && "\n"}
          {indent}
          <span className="text-primary">&quot;{key}&quot;</span>
          <span className="text-muted-foreground">{colon}</span>
          {highlightJsonValue(rest)}
        </span>
      );
    }
    return (
      <span key={i}>
        {i > 0 && "\n"}
        {line}
      </span>
    );
  });
}

function highlightJsonValue(value: string): React.ReactNode {
  const trimmed = value.trim().replace(/,\s*$/, "");
  const trailingComma = value.trim().endsWith(",") ? "," : "";

  if (/^".*"$/.test(trimmed)) {
    return (
      <>
        {" "}
        <span className="text-success">{trimmed}</span>
        {trailingComma}
      </>
    );
  }

  if (/^(true|false|null)$/.test(trimmed)) {
    return (
      <>
        {" "}
        <span className="font-medium">{trimmed}</span>
        {trailingComma}
      </>
    );
  }

  if (/^-?\d/.test(trimmed)) {
    return (
      <>
        {" "}
        <span className="text-warning">{trimmed}</span>
        {trailingComma}
      </>
    );
  }

  return <>{value}</>;
}

// ---------------------------------------------------------------------------
// Clipboard + download utilities (follows useExportResource / ArtifactPreviewModal)
// ---------------------------------------------------------------------------

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK pattern: no external icon dependency)
// ---------------------------------------------------------------------------

function EmptyDataIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6M9 13h4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <path d="M8 4V2.5C8 1.95 7.55 1.5 7 1.5H2.5C1.95 1.5 1.5 1.95 1.5 2.5V7C1.5 7.55 1.95 8 2.5 8H4" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
      <path d="M6 1.5V8.5" />
      <path d="M3 6L6 9L9 6" />
      <path d="M2 10.5H10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true">
      <path d="M2 6.5L4.5 9L10 3" />
    </svg>
  );
}
