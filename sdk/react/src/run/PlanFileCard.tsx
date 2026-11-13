"use client";

import { memo, useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { cn } from "@stigmer/design-tokens";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { GetFileContentInputSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";
import { useStigmer } from "@stigmer/react-core";
import { useFileDownload } from "../file/useFile.js";
import { FilePreviewModal } from "./FilePreviewModal.js";
import { useBuildFromPlanHotkey } from "./use-build-from-plan-hotkey.js";
import { PlanCard } from "./PlanCard.js";

/** Props for {@link PlanFileCard}. */
export interface PlanFileCardProps {
  /** The plan File the Plan-mode turn returned (from `findPlanFile`). */
  readonly file: StigmerFile;
  /**
   * The plan's title (its leading `# H1`). The card is the plan's compact
   * stand-in in the thread, so the title is what makes it recognizable.
   * Falls back to "Plan" when omitted.
   */
  readonly title?: string;
  /**
   * Organization id (a slug is also accepted). Required for the open-in-modal fallback (the shared
   * {@link FilePreviewModal} uses it for its detection/apply pipeline and
   * to fetch the content). When omitted, that fallback is hidden — the
   * prominent "Build" action and the download icon remain.
   */
  readonly org?: string;
  /** Called when the user clicks "Build". Hidden when omitted, and on a `replaced` plan. */
  readonly onImplement?: () => void;
  /**
   * Opens the plan in the session panel's plan document tab — the
   * side-by-side review/refine surface. When provided it REPLACES the
   * modal-based open fallback (one review affordance, not two). When
   * omitted (hosts without a session panel) the same "Open plan" icon
   * opens the preview modal instead.
   */
  readonly onOpenPlan?: () => void;
  /** Disables the primary CTA (e.g., while a run is active). */
  readonly disabled?: boolean;
  /** When true, the primary button reads "Starting build…" (upload in flight). */
  readonly buildPending?: boolean;
  /**
   * A newer plan replaced this one: the subline says "Replaced by a newer
   * plan" and the card offers Open and Copy only, never Download or Build.
   * @default false
   */
  readonly replaced?: boolean;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * The plan card over a Plan-mode turn's plan File: a completed Plan turn's
 * one representation in the thread. The plan document itself lives in the
 * session panel's plan tab (`PlanEditor`): chat carries a recognizable,
 * actionable card; the panel carries the document.
 *
 * Drawn as the thread's one plan card: a list glyph on a muted square, the
 * plan's title over "Plan · 4.1 KB" (never the File's raw name), and the
 * acts at the right: Open, Copy and Download as icons (each named, its name
 * its tooltip), then **Build**, the one primary.
 *
 * Only the LATEST plan's card carries `onImplement`. A plan a newer one
 * replaced is marked `replaced`: its subline says "Replaced by a newer plan"
 * and it offers Open and Copy only, never Build, so a stale plan can never
 * be implemented by accident (its `onOpenPlan` opens the document
 * read-only).
 *
 * All visual properties flow through `--stgm-*` tokens; the component is
 * self-contained and embeddable.
 */
export const PlanFileCard = memo(function PlanFileCard({
  file,
  title,
  org,
  onImplement,
  onOpenPlan,
  disabled,
  buildPending,
  replaced,
  className,
}: PlanFileCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const build = replaced ? undefined : onImplement;
  const handleKeyDown = useBuildFromPlanHotkey(build, disabled);
  const { copy, isCopying, copied } = useFileTextCopy();
  const { download, isDownloading } = useFileDownload();
  const fileId = file.metadata?.id ?? "";
  const name = file.spec?.filename ?? "";
  // The panel's plan tab when the host has one, else the preview modal,
  // which needs the org; one review affordance, never two.
  const openPlan = onOpenPlan ?? (org ? () => setPreviewOpen(true) : undefined);

  return (
    <PlanCard
      role="region"
      aria-label="Plan"
      onKeyDown={handleKeyDown}
      state={replaced ? "replaced" : "ready"}
      title={title ?? "Plan"}
      sizeBytes={file.status?.sizeBytes}
      open={openPlan === undefined ? undefined : { label: "Open plan", onClick: openPlan }}
      copy={{
        label: copied ? "Copied" : isCopying ? "Copying…" : "Copy plan",
        onClick: () => copy(fileId),
        disabled: isCopying,
        copied,
      }}
      download={{
        label: isDownloading ? "Preparing…" : `Download ${name}`,
        onClick: () => download(fileId, name),
        disabled: isDownloading,
      }}
      build={build === undefined ? undefined : { onClick: build, disabled, pending: buildPending }}
      className={cn("stg:mx-4", className)}
    >
      <div role="status" aria-live="polite" aria-atomic="true" className="stg:sr-only">
        {copied && "Plan copied to clipboard"}
      </div>

      {/* The modal open fallback reuses the shared file preview popup —
          the single place that fetches/renders plan content (with Copy +
          Source/Rendered). */}
      {org && previewOpen && (
        <FilePreviewModal
          file={file}
          org={org}
          isTerminal
          open
          onClose={() => setPreviewOpen(false)}
          onImplement={build}
        />
      )}
    </PlanCard>
  );
});

/**
 * Copies a File's text at click time: the card is content-free until the
 * person acts, so the bytes are read only then. The Copy button is disabled
 * while a read is in flight, so a click never starts a second one.
 */
function useFileTextCopy() {
  const stigmer = useStigmer();
  const { copy: writeClipboard, copied } = useCopyFeedback();
  const [isCopying, setIsCopying] = useState(false);
  const copy = useCallback(
    async (fileId: string) => {
      setIsCopying(true);
      try {
        const result = await stigmer.file.getContent(create(GetFileContentInputSchema, { id: fileId }));
        await writeClipboard(new TextDecoder().decode(result.data));
      } catch {
        // A failed read leaves `copied` false: the affordance never claims a copy.
      } finally {
        setIsCopying(false);
      }
    },
    [stigmer, writeClipboard],
  );
  return { copy, isCopying, copied };
}
