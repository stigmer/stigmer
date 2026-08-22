"use client";

import { Copy, Download, FileJson, FileText } from "lucide-react";
import { cn } from "@stigmer/theme";
import { ActionMenu } from "../action-menu/ActionMenu.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import {
  useExportTranscript,
  type UseExportTranscriptOptions,
} from "./useExportTranscript.js";

/** Props for {@link TranscriptExportMenu}. */
export interface TranscriptExportMenuProps extends UseExportTranscriptOptions {
  /** The session whose conversation is exported. */
  readonly sessionId: string | null;
  /** Additional CSS classes for the trigger button. */
  readonly className?: string;
}

/**
 * The whole-conversation export control (stigmer/stigmer#814): a quiet
 * icon-button menu offering **Copy transcript**, **Download Markdown**, and
 * **Download JSON**, powered by {@link useExportTranscript} — the canonical
 * transcript assembly, thinking and resolved tool outputs included.
 *
 * `SessionViewer` renders it in its header corner by default; it is exported
 * so hosts can mount the same control on any other surface a conversation is
 * reachable from (a session list's row menu, a custom header).
 *
 * The export serializes exactly what the viewer already shows the current
 * caller — the RPCs behind it enforce the same `can_view` permission — so
 * offering it to every audience adds convenience, not exposure.
 */
export function TranscriptExportMenu({
  sessionId,
  includeSuperseded,
  className,
}: TranscriptExportMenuProps) {
  const exporter = useExportTranscript(sessionId, { includeSuperseded });

  return (
    <ActionMenu>
      <ActionMenu.Trigger
        aria-label="Export transcript"
        className={cn("stg:size-7", className)}
      >
        {exporter.isExporting ? (
          <SpinnerIcon size={14} />
        ) : (
          <Download className="stg:size-3.5" aria-hidden="true" />
        )}
      </ActionMenu.Trigger>
      <ActionMenu.Content>
        <ActionMenu.Item
          icon={<Copy className="stg:size-3.5" aria-hidden="true" />}
          onSelect={() => void exporter.copyMarkdown()}
          disabled={exporter.isExporting}
        >
          Copy transcript
        </ActionMenu.Item>
        <ActionMenu.Item
          icon={<FileText className="stg:size-3.5" aria-hidden="true" />}
          onSelect={() => void exporter.downloadMarkdown()}
          disabled={exporter.isExporting}
        >
          Download Markdown
        </ActionMenu.Item>
        <ActionMenu.Item
          icon={<FileJson className="stg:size-3.5" aria-hidden="true" />}
          onSelect={() => void exporter.downloadJson()}
          disabled={exporter.isExporting}
        >
          Download JSON
        </ActionMenu.Item>
      </ActionMenu.Content>
    </ActionMenu>
  );
}
