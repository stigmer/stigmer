"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";
import { AttachmentImageLightbox } from "../attachment/AttachmentImageLightbox.js";
import { UNSTYLED_BUTTON } from "../internal/form-primitives.js";
import { useArtifactDownload } from "./useArtifactDownload.js";
import { useArtifactDownloadUrl } from "./useArtifactDownloadUrl.js";

/**
 * The minimal display shape of a submitted attachment.
 *
 * Structurally satisfied by BOTH sources a human turn can carry — the
 * `Attachment` proto on a persisted execution's `spec.attachments` and the
 * `AttachmentInput` a just-submitted (pending) turn holds — so the thread
 * renders either without conversion code or a duplicated type (DD-007).
 */
export interface MessageAttachmentView {
  /** Original filename, e.g. `"screenshot.png"`. */
  readonly filename?: string;
  /** MIME type, e.g. `"image/png"`. Drives the image-vs-document treatment. */
  readonly contentType?: string;
  /** Storage key (`attachments/{ulid}/{filename}`) minted at upload time. */
  readonly storageKey?: string;
}

/** Props for {@link MessageAttachments}. */
export interface MessageAttachmentsProps {
  /** The turn's submitted attachments, in submission order. */
  readonly attachments: readonly MessageAttachmentView[];
  /**
   * The execution the attachments were submitted to. Enables the byte-backed
   * affordances — image previews (presigned URL) and document downloads.
   * Omit for the optimistic pending bubble (no execution record yet): every
   * attachment renders as an inert chip until the real turn replaces it.
   */
  readonly executionId?: string;
  /** Additional CSS class names for the row container. */
  readonly className?: string;
}

/**
 * The attachment row on a human turn: the durable evidence of what files were
 * sent with the message (stigmer/stigmer#372).
 *
 * Image attachments render as preview chips — a recognizable miniature plus
 * the filename, click-to-open in the shared {@link AttachmentImageLightbox} —
 * and documents as compact click-to-download chips. Both follow the composer
 * chip grammar ({@link AttachmentChipList}) so a file looks the same before
 * and after send, but this is deliberately a separate component: the composer
 * chip is interactive and upload-phase-bound over a local `File`, while this
 * row is read-only over the execution record, with bytes resolved on demand
 * from the stable storage key via presigned URLs (the `OutputRefImage`
 * pattern — the local `File` is gone after submit).
 *
 * Purely presentational plus on-demand URL minting — no required wiring.
 * All visual properties flow through `--stgm-*` tokens.
 */
export function MessageAttachments({
  attachments,
  executionId,
  className,
}: MessageAttachmentsProps) {
  // One lightbox instance serves the whole row, tracked by storage key
  // (direct identity). It mounts OUTSIDE the role="list" container — a
  // <dialog> is not valid inside the chips' <span> elements, and a
  // non-listitem child inside the list would break its a11y ownership
  // (same reasoning as the composer's chip list).
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const previewed =
    previewKey !== null
      ? (attachments.find((a) => a.storageKey === previewKey) ?? null)
      : null;

  if (attachments.length === 0) return null;

  return (
    <>
      <div
        className={cn("flex flex-wrap gap-1.5", className)}
        role="list"
        aria-label="Submitted attachments"
      >
        {attachments.map((attachment, i) => {
          const isImage = attachment.contentType?.startsWith("image/") ?? false;
          const key = attachment.storageKey ?? `${displayName(attachment)}-${i}`;
          return isImage && executionId && attachment.storageKey ? (
            <ImagePreviewChip
              key={key}
              attachment={attachment}
              executionId={executionId}
              onPreview={() => setPreviewKey(attachment.storageKey!)}
            />
          ) : (
            <DocumentChip
              key={key}
              attachment={attachment}
              executionId={executionId}
            />
          );
        })}
      </div>
      {previewed && executionId && previewed.storageKey && (
        <AttachmentPreviewLightbox
          attachment={previewed}
          executionId={executionId}
          onClose={() => setPreviewKey(null)}
        />
      )}
    </>
  );
}

/**
 * Display name for an attachment: the filename, falling back to the storage
 * key's basename (`attachments/{ulid}/{filename}` always ends in it).
 */
function displayName(attachment: MessageAttachmentView): string {
  if (attachment.filename) return attachment.filename;
  const key = attachment.storageKey ?? "";
  const base = key.slice(key.lastIndexOf("/") + 1);
  return base || "attachment";
}

// ---------------------------------------------------------------------------
// Image attachment — a preview chip mirroring the composer's miniature
// ---------------------------------------------------------------------------

/**
 * Recognizable miniature + filename, minted from the stable storage key at
 * view time. If the URL can't be resolved (revoked storage, transient API
 * failure), the chip degrades to the document treatment — a generic icon with
 * the download affordance — never a broken-image glyph.
 */
function ImagePreviewChip({
  attachment,
  executionId,
  onPreview,
}: {
  readonly attachment: MessageAttachmentView;
  readonly executionId: string;
  readonly onPreview: () => void;
}) {
  const { url, error } = useArtifactDownloadUrl(
    executionId,
    attachment.storageKey ?? null,
  );
  const name = displayName(attachment);

  if (error) {
    return <DocumentChip attachment={attachment} executionId={executionId} />;
  }

  return (
    <span
      role="listitem"
      aria-label={name}
      title={name}
      className="inline-flex max-w-[240px] items-center gap-1 rounded-md bg-muted-subtle p-1 pr-1.5 text-xs text-foreground"
    >
      {/* UNSTYLED_BUTTON is load-bearing: without it the chip body shows the
          UA's default button box in preflight-less hosts (see the constant). */}
      <button
        type="button"
        onClick={onPreview}
        aria-label={`Preview ${name}`}
        className={cn(
          UNSTYLED_BUTTON,
          "flex min-w-0 items-center gap-1.5 rounded-sm text-inherit [font:inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded">
          {url ? (
            <img
              src={url}
              alt=""
              aria-hidden="true"
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            // Pulse placeholder while the presigned URL is minted; same
            // footprint as the image, so no layout shift.
            <span
              className="block h-full w-full animate-pulse bg-muted"
              aria-hidden="true"
            />
          )}
        </span>
        <span className="min-w-0 truncate">{name}</span>
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Document attachment — compact chip, click-to-download
// ---------------------------------------------------------------------------

/**
 * The compact treatment for documents (and for any attachment before its
 * execution record exists). With an execution id, the chip is a download
 * button — a fresh URL is minted at click time via {@link useArtifactDownload},
 * saved under the original filename. Without one (pending bubble), it is an
 * inert label: evidence the file was sent, affordances once the record lands.
 */
function DocumentChip({
  attachment,
  executionId,
}: {
  readonly attachment: MessageAttachmentView;
  readonly executionId?: string;
}) {
  const { download, isDownloading } = useArtifactDownload(executionId ?? null);
  const name = displayName(attachment);
  const downloadable = executionId != null && !!attachment.storageKey;

  const content = (
    <>
      <FileGlyph />
      <span className="min-w-0 truncate">{name}</span>
    </>
  );

  return (
    <span
      role="listitem"
      aria-label={name}
      title={name}
      className="inline-flex max-w-[200px] items-center rounded-md bg-muted-subtle px-2 py-0.5 text-xs text-foreground"
    >
      {downloadable ? (
        <button
          type="button"
          onClick={() => void download(attachment.storageKey!, name)}
          disabled={isDownloading}
          aria-label={`Download ${name}`}
          className={cn(
            UNSTYLED_BUTTON,
            "flex min-w-0 items-center gap-1 rounded-sm text-inherit [font:inherit] hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isDownloading && "opacity-70",
          )}
        >
          {content}
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-1">{content}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Lightbox bridge
// ---------------------------------------------------------------------------

/**
 * Feeds the previewed attachment's presigned URL to the shared
 * {@link AttachmentImageLightbox}. The URL hook is cross-mount cached by
 * storage key (DD-014), so opening the lightbox reuses the thumbnail's minted
 * URL instead of a second RPC; `src` is `null` for at most the first frame.
 */
function AttachmentPreviewLightbox({
  attachment,
  executionId,
  onClose,
}: {
  readonly attachment: MessageAttachmentView;
  readonly executionId: string;
  readonly onClose: () => void;
}) {
  const { url } = useArtifactDownloadUrl(
    executionId,
    attachment.storageKey ?? null,
  );

  return (
    <AttachmentImageLightbox
      src={url}
      filename={displayName(attachment)}
      open
      onClose={onClose}
    />
  );
}

/**
 * Generic document glyph — the same geometry as the composer chip's icon so
 * the two surfaces read as one family.
 */
function FileGlyph() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M8 1H4C3.45 1 3 1.45 3 2V12C3 12.55 3.45 13 4 13H10C10.55 13 11 12.55 11 12V4L8 1Z" />
      <path d="M8 1V4H11" />
    </svg>
  );
}
