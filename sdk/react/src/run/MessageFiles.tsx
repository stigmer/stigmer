"use client";

/**
 * The row of files on a person's message: what was given with the turn,
 * read from the run's `status.messageFiles` (or, before the run exists,
 * from the chat box's hand-off).
 *
 * Trade-offs:
 * - A chip carries only a File id and its kind; the name and size are the
 *   File's own, read through `stigmer.file.get` and cached by id, so a chip
 *   always shows the name the File was uploaded under.
 * - A link to the bytes expires, so a document's is minted on click and an
 *   image's only for its tile, never stored with the message.
 */

import { useState } from "react";
import { cn } from "@stigmer/design-tokens";
import type { ContentBlock } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_content_pb";
import { ImageLightbox } from "../upload/ImageLightbox.js";
import { useFile, useFileDownload, useFileDownloadUrl } from "../file/useFile.js";
import { UNSTYLED_BUTTON } from "../internal/form-primitives.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { TruncatedText } from "../internal/truncated-text.js";
import { formatFileSize } from "../file/file-size.js";

/**
 * One file given with a message, as the thread shows it.
 *
 * Built from a run's `status.messageFiles` ({@link messageFileViews}) for a
 * turn the server recorded, and from the chat box's hand-off
 * (`FileHandOff.files`) for the optimistic bubble.
 */
export interface MessageFileView {
  /** The File's id (`"file_01j…"`): what its name, size and link are read by. */
  readonly fileId?: string;
  /** The filename, when known without reading the File. */
  readonly filename?: string;
  /** `"image"` shows a preview tile; `"document"` a click-to-download chip. */
  readonly kind: "image" | "document";
}

const NO_VIEWS: readonly MessageFileView[] = [];
const viewsByBlocks = new WeakMap<readonly ContentBlock[], readonly MessageFileView[]>();

/**
 * The chips of a turn's `RunStatus.message_files`: one per image or
 * document block whose source is a File, in the message's order.
 *
 * The result is cached by the blocks' identity, so a thread rebuilt on
 * every streamed frame hands the memoised message rows the same array and
 * only the changing row re-renders.
 */
export function messageFileViews(blocks: readonly ContentBlock[]): readonly MessageFileView[] {
  if (blocks.length === 0) return NO_VIEWS;
  const cached = viewsByBlocks.get(blocks);
  if (cached) return cached;
  const views = blocks.flatMap((block): MessageFileView[] => {
    const fileId = block.source?.type === "file" ? block.source.fileId : "";
    if (!fileId) return [];
    return [
      {
        fileId,
        filename: block.title || undefined,
        kind: block.type === "image" ? "image" : "document",
      },
    ];
  });
  viewsByBlocks.set(blocks, views);
  return views;
}

/** Props for {@link MessageFiles}. */
export interface MessageFilesProps {
  /** The turn's files, in the message's order. */
  readonly files: readonly MessageFileView[];
  /**
   * The run the files were given with. Its presence makes the chips live:
   * image previews and document downloads. Omit for the optimistic bubble
   * and a failed send, where the chips are inert evidence of what was sent.
   */
  readonly runId?: string;
  /** Additional CSS class names for the row container. */
  readonly className?: string;
}

/**
 * The file row on a person's message: the durable evidence of what files
 * were sent with it (stigmer/stigmer#372).
 *
 * Images render as preview-only thumbnail tiles (the name stays in the
 * tooltip, the accessible label and the lightbox header), click-to-open in
 * the shared {@link ImageLightbox}; documents as compact
 * click-to-download chips with their size. Both follow the composer chip
 * grammar ({@link FileChipList}) so a file looks the same before and
 * after send.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */
export function MessageFiles({ files, runId, className }: MessageFilesProps) {
  // One lightbox serves the row, tracked by File id. It mounts outside the
  // role="list" container: a <dialog> is not valid inside the chips'
  // <span> elements, and a non-listitem child would break the list's
  // accessibility ownership.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const live = runId !== undefined;
  const previewed =
    previewId !== null ? (files.find((f) => f.fileId === previewId) ?? null) : null;

  if (files.length === 0) return null;

  return (
    <>
      {/* items-center is load-bearing: image tiles (h-14) and document chips
          (~h-6) share this row, and flexbox's default stretch alignment
          would balloon the document chips to tile height. */}
      <div
        className={cn("stg:flex stg:flex-wrap stg:items-center stg:gap-1.5", className)}
        role="list"
        aria-label="Files sent with this message"
      >
        {files.map((view, i) => {
          const key = view.fileId ?? `${view.filename ?? "file"}-${i}`;
          if (view.kind === "image" && live && view.fileId) {
            const fileId = view.fileId;
            return (
              <ImagePreviewChip
                key={key}
                view={view}
                fileId={fileId}
                onPreview={() => setPreviewId(fileId)}
              />
            );
          }
          if (view.kind === "image") {
            // No run record: the optimistic bubble or a failed send. The
            // tile keeps the image grammar but stays static (a glyph, not a
            // pulse): a failed send never gets a run, so a pulse would be
            // a permanent false "loading" signal.
            return <ImageGlyphTile key={key} name={view.filename ?? "image"} />;
          }
          return <DocumentChip key={key} view={view} live={live} />;
        })}
      </div>
      {previewed?.fileId && (
        <FilePreviewLightbox
          view={previewed}
          fileId={previewed.fileId}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  );
}

/** The chip's name: the File's own, else the name the chip carries. */
function useDisplayName(view: MessageFileView, live: boolean): {
  readonly name: string;
  readonly sizeBytes: number | null;
} {
  const { file } = useFile(live ? (view.fileId ?? null) : null);
  const name = file?.spec?.filename || view.filename || "file";
  const size = file?.status?.sizeBytes;
  return { name, sizeBytes: size !== undefined ? Number(size) : null };
}

// ---------------------------------------------------------------------------
// Image — a preview-only tile mirroring the composer's grammar
// ---------------------------------------------------------------------------

/**
 * The preview-only image tile, its thumbnail minted from the File at view
 * time. If no link can be minted (the File is gone, the API failed), the
 * chip degrades to the document treatment, never a broken-image glyph.
 */
function ImagePreviewChip({
  view,
  fileId,
  onPreview,
}: {
  readonly view: MessageFileView;
  readonly fileId: string;
  readonly onPreview: () => void;
}) {
  const { url, error } = useFileDownloadUrl(fileId);
  const { name } = useDisplayName(view, true);

  if (error) {
    return <DocumentChip view={view} live />;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={<span role="listitem" aria-label={name} className="stg:inline-flex" />}
      >
        {/* The whole tile is the preview target. UNSTYLED_BUTTON adds the
            pointer cursor, the tile's only clickability cue. */}
        <button
          type="button"
          onClick={onPreview}
          aria-label={`Preview ${name}`}
          className={cn(
            UNSTYLED_BUTTON,
            "stg:relative stg:block stg:h-14 stg:w-14 stg:overflow-hidden stg:rounded-md stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        >
          {url ? (
            <img
              src={url}
              alt=""
              aria-hidden="true"
              loading="lazy"
              className="stg:h-full stg:w-full stg:object-cover"
            />
          ) : (
            // Pulse while the link is minted: work is in flight. Same
            // footprint as the image, so no layout shift.
            <span
              className="stg:block stg:h-full stg:w-full stg:animate-pulse stg:bg-muted"
              aria-hidden="true"
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="stg:break-all">
        {name}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The inert image tile for a turn with no run record yet (the optimistic
 * bubble) or ever (a failed send): the image grammar with a static glyph,
 * since a pulse would promise bytes that may never arrive.
 */
function ImageGlyphTile({ name }: { readonly name: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="listitem"
            aria-label={name}
            className="stg:inline-flex stg:h-14 stg:w-14 stg:items-center stg:justify-center stg:rounded-md stg:bg-muted-subtle"
          />
        }
      >
        <ImageGlyph />
      </TooltipTrigger>
      <TooltipContent side="top" className="stg:break-all">
        {name}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Document — compact chip, click-to-download
// ---------------------------------------------------------------------------

/**
 * The compact treatment for documents. Live, the chip is a download button
 * whose link is minted at click time and saved under the File's name, with
 * the File's size beside it. Inert (no run yet), it is a label: evidence
 * the file was sent.
 */
function DocumentChip({
  view,
  live,
}: {
  readonly view: MessageFileView;
  readonly live: boolean;
}) {
  const { download, isDownloading } = useFileDownload();
  const { name, sizeBytes } = useDisplayName(view, live);
  const fileId = live ? view.fileId : undefined;

  const content = (
    <>
      <FileGlyph />
      <TruncatedText text={name} className="stg:min-w-0" />
      {sizeBytes !== null && (
        <span className="stg:shrink-0 stg:text-muted-foreground">{formatFileSize(sizeBytes)}</span>
      )}
    </>
  );

  return (
    <span
      role="listitem"
      aria-label={name}
      className="stg:inline-flex stg:max-w-[200px] stg:items-center stg:rounded-md stg:bg-muted-subtle stg:px-2 stg:py-0.5 stg:text-xs stg:text-foreground"
    >
      {fileId ? (
        <button
          type="button"
          onClick={() => void download(fileId, name)}
          disabled={isDownloading}
          aria-label={`Download ${name}`}
          className={cn(
            UNSTYLED_BUTTON,
            "stg:flex stg:min-w-0 stg:items-center stg:gap-1 stg:rounded-sm stg:hover:text-accent-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            isDownloading && "stg:opacity-70",
          )}
        >
          {content}
        </button>
      ) : (
        <span className="stg:flex stg:min-w-0 stg:items-center stg:gap-1">{content}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Lightbox bridge
// ---------------------------------------------------------------------------

/**
 * Feeds the previewed image's link to the shared
 * {@link ImageLightbox}. The link is cached by File id, so the
 * lightbox reuses the thumbnail's instead of minting a second.
 */
function FilePreviewLightbox({
  view,
  fileId,
  onClose,
}: {
  readonly view: MessageFileView;
  readonly fileId: string;
  readonly onClose: () => void;
}) {
  const { url } = useFileDownloadUrl(fileId);
  const { name } = useDisplayName(view, true);

  return <ImageLightbox src={url} filename={name} open onClose={onClose} />;
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
      className="stg:shrink-0 stg:text-muted-foreground"
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
      className="stg:shrink-0 stg:text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M8 1H4C3.45 1 3 1.45 3 2V12C3 12.55 3.45 13 4 13H10C10.55 13 11 12.55 11 12V4L8 1Z" />
      <path d="M8 1V4H11" />
    </svg>
  );
}
