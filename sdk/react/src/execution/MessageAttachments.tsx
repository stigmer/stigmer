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
   * Omit for the optimistic pending bubble (no execution record yet) and the
   * failed-send bubble (no record ever): images render as inert glyph tiles
   * and documents as inert chips until a real turn brings the presign seam.
   */
  readonly executionId?: string;
  /** Additional CSS class names for the row container. */
  readonly className?: string;
}

/**
 * The attachment row on a human turn: the durable evidence of what files were
 * sent with the message (stigmer/stigmer#372).
 *
 * Image attachments render as preview-only thumbnail tiles — the image IS the
 * chip, no filename text (the name stays in the tooltip, the accessible
 * label, and the lightbox header), click-to-open in the shared
 * {@link AttachmentImageLightbox} — and documents as compact click-to-download
 * filename chips. Both follow the composer chip grammar
 * ({@link AttachmentChipList}) so a file looks the same before and after
 * send, but this is deliberately a separate component: the composer chip is
 * interactive and upload-phase-bound over a local `File`, while this row is
 * read-only over the execution record, with bytes resolved on demand from
 * the stable storage key via presigned URLs (the `OutputRefImage` pattern —
 * the local `File` is gone after submit).
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
      {/* items-center is load-bearing: image tiles (h-14) and document chips
          (~h-6) share this row, and flexbox's default stretch alignment
          would balloon the document chips to tile height. */}
      <div
        className={cn("flex flex-wrap items-center gap-1.5", className)}
        role="list"
        aria-label="Submitted attachments"
      >
        {attachments.map((attachment, i) => {
          const isImage = attachment.contentType?.startsWith("image/") ?? false;
          const key = attachment.storageKey ?? `${displayName(attachment)}-${i}`;
          if (isImage && executionId && attachment.storageKey) {
            return (
              <ImagePreviewChip
                key={key}
                attachment={attachment}
                executionId={executionId}
                onPreview={() => setPreviewKey(attachment.storageKey!)}
              />
            );
          }
          if (isImage && !executionId) {
            // No execution record — the optimistic pending bubble or a
            // failed send. The tile keeps the image grammar but stays
            // STATIC (a glyph, not a pulse): a failed send never gets an
            // executionId, so a pulse here would be a permanent false
            // "loading" signal. On the pending bubble the real turn lands
            // under the same bridge key and brings the presign seam.
            return <ImageGlyphTile key={key} name={displayName(attachment)} />;
          }
          return (
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
// Image attachment — a preview-only tile mirroring the composer's grammar
// ---------------------------------------------------------------------------

/**
 * The preview-only image tile: the thumbnail IS the chip, minted from the
 * stable storage key at view time — no filename text (the name stays in the
 * tooltip, the accessible label, and the lightbox header). If the URL can't
 * be resolved (revoked storage, transient API failure), the chip degrades to
 * the document treatment — a generic icon with the download affordance —
 * never a broken-image glyph.
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
    <span role="listitem" aria-label={name} title={name} className="inline-flex">
      {/* The whole tile is the preview target. UNSTYLED_BUTTON adds the
          pointer cursor — the image tile carries no other clickability
          cue. */}
      <button
        type="button"
        onClick={onPreview}
        aria-label={`Preview ${name}`}
        className={cn(
          UNSTYLED_BUTTON,
          "relative block h-14 w-14 overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {url ? (
          <img
            src={url}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          // Pulse placeholder while the presigned URL is minted — pulse
          // means work is genuinely in flight (contrast ImageGlyphTile).
          // Same footprint as the image, so no layout shift.
          <span
            className="block h-full w-full animate-pulse bg-muted"
            aria-hidden="true"
          />
        )}
      </button>
    </span>
  );
}

/**
 * The inert image tile for a turn with no execution record yet (optimistic
 * pending bubble) or ever (failed send). Keeps the image grammar — same
 * footprint as {@link ImagePreviewChip} — but shows a STATIC glyph, not a
 * pulse: a pulse promises bytes that, on a failed send, will never arrive.
 */
function ImageGlyphTile({ name }: { readonly name: string }) {
  return (
    <span
      role="listitem"
      aria-label={name}
      title={name}
      className="inline-flex h-14 w-14 items-center justify-center rounded-md bg-muted-subtle"
    >
      <ImageGlyph />
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
            "flex min-w-0 items-center gap-1 rounded-sm hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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

/** Generic picture glyph for the inert {@link ImageGlyphTile}. */
function ImageGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
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
