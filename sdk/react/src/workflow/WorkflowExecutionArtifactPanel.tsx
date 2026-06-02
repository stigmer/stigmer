"use client";

import { memo, useCallback, useState } from "react";
import type { Artifact } from "@stigmer/protos/ai/stigmer/agentic/artifact/v1/api_pb";
import { cn } from "@stigmer/theme";
import { useStigmer } from "../hooks";
import { formatBytes } from "./format-utils";

/** Props for {@link WorkflowExecutionArtifactPanel}. */
export interface WorkflowExecutionArtifactPanelProps {
  /** Artifacts produced by the execution. */
  readonly artifacts: readonly Artifact[];
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Sidebar panel listing artifacts produced by the workflow execution.
 * Each artifact shows its display name, content type, size, and a
 * download button that fetches a pre-signed URL via `getDownloadUrl`.
 */
export const WorkflowExecutionArtifactPanel = memo(function WorkflowExecutionArtifactPanel({
  artifacts,
  className,
}: WorkflowExecutionArtifactPanelProps) {
  if (artifacts.length === 0) return null;

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Artifacts
        </h3>
      </div>

      <div className="flex flex-col">
        {artifacts.map((artifact) => (
          <ArtifactRow key={artifact.metadata?.id ?? artifact.metadata?.name} artifact={artifact} />
        ))}
      </div>
    </div>
  );
});

function ArtifactRow({ artifact }: { readonly artifact: Artifact }) {
  const stigmer = useStigmer();
  const [isDownloading, setIsDownloading] = useState(false);

  const id = artifact.metadata?.id ?? "";
  const displayName = artifact.spec?.displayName ?? artifact.metadata?.name ?? "Unnamed";
  const contentType = artifact.spec?.contentType ?? "";
  const sizeBytes = artifact.status?.sizeBytes ?? BigInt(0);

  const handleDownload = useCallback(async () => {
    if (!id || isDownloading) return;
    setIsDownloading(true);
    try {
      const downloadUrl = await stigmer.artifact.getDownloadUrl(id);
      if (downloadUrl.url) {
        window.open(downloadUrl.url, "_blank", "noopener,noreferrer");
      }
    } catch {
      // Graceful degradation — download not available
    } finally {
      setIsDownloading(false);
    }
  }, [id, stigmer, isDownloading]);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground" aria-hidden="true">
        <FileIcon />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-foreground">{displayName}</p>
        <p className="text-[10px] text-muted-foreground">
          {contentType}
          {sizeBytes > BigInt(0) && <> · {formatBytes(sizeBytes)}</>}
        </p>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={isDownloading || !id}
        className={cn(
          "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
          "border border-border text-muted-foreground",
          "hover:bg-muted hover:text-foreground",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
        aria-label={`Download ${displayName}`}
      >
        {isDownloading ? "…" : "↓"}
      </button>
    </div>
  );
}

function FileIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M7 1H3a1 1 0 00-1 1v8a1 1 0 001 1h6a1 1 0 001-1V4L7 1z" />
      <path d="M7 1v3h3" />
    </svg>
  );
}

