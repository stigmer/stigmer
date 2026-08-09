/**
 * Clipboard file extraction for composer surfaces — the paste half of
 * "paste a screenshot and the agent sees it" (stigmer/stigmer#284).
 *
 * Extraction is deliberately SYNCHRONOUS. Clipboard file handles are only
 * reliable while the paste event is being dispatched, and the caller must
 * decide `preventDefault()` in the same tick (a copied image usually carries
 * an HTML/text flavor that would otherwise paste as junk markup). An async
 * "one call" API here would pass in tests and lose pastes in real browsers.
 * Async work on the extracted files (e.g. {@link prepareImageForVision})
 * happens after extraction, on plain `File` objects that stay valid.
 */

/**
 * Structural source for {@link extractClipboardFiles}: both the native
 * `ClipboardEvent` and React's synthetic clipboard event satisfy it.
 */
export interface ClipboardFilesSource {
  readonly clipboardData: { readonly files: FileList } | null;
}

/**
 * Names browsers assign to clipboard images that never had a real filename
 * (a screenshot, an image copied off a web page). Chrome, Firefox, and
 * Safari all use `image.<ext>`. A file pasted from the OS file manager
 * keeps its real name and never matches.
 */
const GENERIC_CLIPBOARD_IMAGE_NAME = /^image\.(png|jpe?g|gif|webp|tiff?|bmp|avif)$/i;

/** Extension for a synthesized name, keyed by the clipboard MIME type. */
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/tiff": "tiff",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

/**
 * Monotonic per-page-session counter. Combined with the time component this
 * keeps synthesized names unique even across page reloads within one agent
 * session — required because attachments materialize at
 * `.stigmer/inputs/{filename}` in a session-scoped directory, where a
 * repeated name from a later turn silently replaces the earlier turn's file.
 */
let pasteSequence = 0;

function synthesizePastedImageName(mimeType: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const ext = IMAGE_MIME_EXTENSIONS[mimeType.toLowerCase()] ?? "png";
  pasteSequence += 1;
  return `pasted-image-${time}-${pasteSequence}.${ext}`;
}

/**
 * Extracts files from a paste event, giving clipboard images that carry the
 * browser's generic `image.png` name a unique, human-readable one
 * (`pasted-image-<HHMMSS>-<n>.<ext>`).
 *
 * Unique names are load-bearing, not cosmetic: attachments mount at
 * `.stigmer/inputs/{filename}`, and two same-named attachments either fail
 * the execution (deep-agent harness) or silently overwrite each other
 * (Cursor harness). Files with real names (pasted from a file manager) are
 * returned unchanged.
 *
 * Returns an empty array for a text-only paste — callers use that to let
 * the default text insertion proceed untouched.
 *
 * Must be called synchronously from the paste event handler. Call
 * `event.preventDefault()` in the same tick when the result is non-empty;
 * the returned `File` objects remain valid afterwards.
 *
 * @example
 * ```tsx
 * function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
 *   const files = extractClipboardFiles(e);
 *   if (files.length === 0) return; // plain text paste — leave it alone
 *   e.preventDefault();
 *   attachments.addFiles(files);
 * }
 * ```
 */
export function extractClipboardFiles(event: ClipboardFilesSource): File[] {
  const fileList = event.clipboardData?.files;
  if (!fileList || fileList.length === 0) return [];

  return Array.from(fileList).map((file) => {
    const isGenericImage =
      file.type.toLowerCase().startsWith("image/") &&
      (file.name === "" || GENERIC_CLIPBOARD_IMAGE_NAME.test(file.name));
    if (!isGenericImage) return file;

    return new File([file], synthesizePastedImageName(file.type, new Date()), {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
}
