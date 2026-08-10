"use client";

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ConversationMediaRef } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { GetConversationMediaDownloadUrlInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { AttachmentImageLightbox } from "../attachment/AttachmentImageLightbox.js";
import { formatFileSize } from "../attachment/attachment-utils.js";
import { UNSTYLED_BUTTON } from "../internal/form-primitives.js";
import { toError } from "../internal/toError.js";
import { useStigmer } from "../hooks.js";
import { useConversationMediaUrl } from "./useConversationMediaUrl.js";

/**
 * The full address of one timeline item's media — what
 * `getMediaDownloadUrl` is addressed by. The storage key deliberately
 * never rides the wire (whatsapp-media DD-001 D4); the server resolves
 * it from its own row, so this address is all a client ever holds.
 */
export interface ConversationMediaAddress {
  /** AgentChannel the conversation belongs to. */
  readonly agentChannelId: string;
  /** Conversation key within the channel (WhatsApp: the customer's wa_id). */
  readonly conversationKey: string;
  /** The timeline item carrying the media (its item_id, e.g. `"wa:<wamid>"`). */
  readonly itemId: string;
}

/** Props for {@link ConversationMediaAttachment}. */
export interface ConversationMediaAttachmentProps {
  /** The item's media reference (filename, content type, size). */
  readonly media: ConversationMediaRef;
  /** Where to fetch the bytes from. */
  readonly address: ConversationMediaAddress;
  /** Additional CSS classes for the container. */
  readonly className?: string;
}

/**
 * One inbound timeline item's ingested media (stigmer/stigmer#367):
 * images as a WhatsApp-style inline thumbnail (click opens the shared
 * {@link AttachmentImageLightbox}), everything else as a document chip
 * (filename + size, click opens the file in a new tab).
 *
 * This component calls `useStigmer()`, so it must only be MOUNTED when
 * the timeline view holds a conversation address — that conditional
 * mount is what keeps `ConversationTimelineView` renderable without a
 * `StigmerProvider` (its presentational contract; see the view's
 * `agentChannelId` prop).
 *
 * Deliberately a sibling of the execution thread's `MessageAttachments`,
 * not a reuse of it: that row renders storage-key-addressed artifacts of
 * an execution the viewer owns, while this one renders
 * conversation-viewer-scoped media addressed by timeline position — the
 * two read paths have different trust models (DD-001 D4) and different
 * bubble treatments (chat thumbnail vs. attachment chip row).
 */
export function ConversationMediaAttachment({
  media,
  address,
  className,
}: ConversationMediaAttachmentProps) {
  const isImage = media.contentType.startsWith("image/");
  return isImage ? (
    <MediaImageThumbnail media={media} address={address} className={className} />
  ) : (
    <MediaDocumentChip media={media} address={address} className={className} />
  );
}

/**
 * Display name for the media: the ingest-recorded filename (documents
 * keep the provider's name; camera images get a platform-synthesized
 * one, so this is never empty in practice), with a defensive fallback.
 */
function displayName(media: ConversationMediaRef): string {
  return media.filename || "attachment";
}

// ---------------------------------------------------------------------------
// Image — WhatsApp-style inline thumbnail, click-to-open lightbox
// ---------------------------------------------------------------------------

/**
 * A bounded preview frame in the bubble, minted from the item address at
 * view time. The frame is fixed-size for BOTH the pulse placeholder and
 * the loaded image, so the load causes no layout shift (the
 * content-agnostic auto-scroll then needs no special case). If the URL
 * can't be minted (revoked media, transient API failure, the server's
 * uniform NOT_FOUND), the treatment degrades to the document chip —
 * never a broken-image glyph (the `MessageAttachments` precedent).
 */
function MediaImageThumbnail({
  media,
  address,
  className,
}: {
  readonly media: ConversationMediaRef;
  readonly address: ConversationMediaAddress;
  readonly className?: string;
}) {
  const { url, error } = useConversationMediaUrl(
    address.agentChannelId,
    address.conversationKey,
    address.itemId,
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const name = displayName(media);

  if (error) {
    return <MediaDocumentChip media={media} address={address} className={className} />;
  }

  return (
    <>
      {/* UNSTYLED_BUTTON is load-bearing: without it the thumbnail shows
          the UA's default button box in preflight-less hosts. */}
      <button
        type="button"
        onClick={() => setPreviewOpen(true)}
        aria-label={`Preview ${name}`}
        className={cn(
          UNSTYLED_BUTTON,
          "block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <span className="relative block h-40 w-56 max-w-full overflow-hidden rounded-md">
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
      </button>
      {previewOpen && (
        <AttachmentImageLightbox
          src={url}
          filename={name}
          open
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Document — compact chip, click-to-open in a new tab
// ---------------------------------------------------------------------------

/**
 * The compact treatment for documents (and the degraded arm for images
 * whose URL failed): file glyph, filename, size. A click mints a FRESH
 * URL — presigned URLs expire, so the stable item address is the thing
 * to hold, not a URL (the `useArtifactDownload` rationale) — and opens
 * it in a new tab: the media contract presigns inline disposition only,
 * so the browser previews what it can (PDFs) and downloads the rest.
 * A failed mint reports below the chip in the surface's own error
 * grammar (DD-006 — never a silent dead click).
 */
function MediaDocumentChip({
  media,
  address,
  className,
}: {
  readonly media: ConversationMediaRef;
  readonly address: ConversationMediaAddress;
  readonly className?: string;
}) {
  const { open, isOpening, error } = useOpenConversationMedia(address);
  const name = displayName(media);
  const size = media.sizeBytes > BigInt(0)
    ? // WhatsApp caps media far below 2^53 bytes, so the narrowing is exact.
      formatFileSize(Number(media.sizeBytes))
    : null;

  return (
    <div className={className}>
      <span
        title={name}
        className="inline-flex max-w-[240px] items-center rounded-md bg-muted-subtle px-2 py-1 text-xs text-foreground"
      >
        <button
          type="button"
          onClick={() => void open()}
          disabled={isOpening}
          aria-label={`Open ${name}`}
          className={cn(
            UNSTYLED_BUTTON,
            "flex min-w-0 items-center gap-1.5 rounded-sm text-inherit [font:inherit] hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isOpening && "opacity-70",
          )}
        >
          <FileGlyph />
          <span className="min-w-0 truncate">{name}</span>
          {size !== null && (
            <span className="shrink-0 text-muted-foreground">{size}</span>
          )}
        </button>
      </span>
      {error !== null && (
        <p className="mt-1 break-words text-xs text-destructive">
          {getUserMessage(error)}
        </p>
      )}
    </div>
  );
}

/**
 * Click → mint fresh URL → open in a new tab. Kept local to this file:
 * unlike {@link useConversationMediaUrl} (render data), an open is a
 * user action — and it must complete within the browser's
 * user-activation window, which the single fast unary mint does.
 */
function useOpenConversationMedia(address: ConversationMediaAddress): {
  readonly open: () => Promise<void>;
  readonly isOpening: boolean;
  readonly error: Error | null;
} {
  const stigmer = useStigmer();
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const open = useCallback(async () => {
    if (isOpening) return;
    setIsOpening(true);
    setError(null);
    try {
      const result = await stigmer.agentChannel.getMediaDownloadUrl(
        create(GetConversationMediaDownloadUrlInputSchema, {
          agentChannelId: address.agentChannelId,
          conversationKey: address.conversationKey,
          itemId: address.itemId,
        }),
      );
      if (result.url) {
        openInNewTab(result.url);
      }
    } catch (err) {
      setError(toError(err));
    } finally {
      setIsOpening(false);
    }
  }, [stigmer, address.agentChannelId, address.conversationKey, address.itemId, isOpening]);

  return useMemo(() => ({ open, isOpening, error }), [open, isOpening, error]);
}

/**
 * Open a URL in a new tab via a transient anchor click (the
 * `triggerBrowserDownload` shape, minus the `download` hint — the URL's
 * disposition is inline and cross-origin anchors ignore the attribute
 * anyway). Falls back to `window.open` in non-DOM environments.
 */
function openInNewTab(url: string): void {
  if (typeof document === "undefined") {
    if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  anchor.target = "_blank";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/**
 * Generic document glyph — the same geometry as the attachment chips'
 * icon so the surfaces read as one family.
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
