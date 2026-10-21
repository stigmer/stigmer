/**
 * Browser-side image preparation for agent vision — the canvas half of
 * "paste a screenshot and the agent sees it" (stigmer/stigmer#284).
 *
 * A screenshot from a large display is routinely a 4-10 MB PNG. The runner
 * delivers images to the model inline only under its per-image byte cap
 * (3 MiB raw; see the runner's `shared/attachment-vision.ts`), so an
 * unprepared paste degrades to "I can't see this file". Bounding the image
 * to the resolution providers actually process (see vision-fit.ts) is
 * quality-neutral and brings real screenshots far under that cap — while
 * also making the upload roughly 20× faster.
 *
 * Applied to PASTED images only, by the composer's paste handler. Picked
 * and dragged files are never re-encoded: a chosen file may be the subject
 * of the task ("read the EXIF", "embed this logo"), and silently altering
 * it would be a regression. A pasted image has no file identity to preserve.
 *
 * Failure policy: this module never throws and never returns a broken file.
 * Every failure path — no canvas API (old browsers, privacy extensions,
 * non-browser test environments), undecodable bytes, encoder failure —
 * returns the ORIGINAL file, which still works end to end: it uploads,
 * mounts in the workspace, and merely degrades at the runner with the
 * standard "not viewable inline" disclosure.
 */

import {
  exceedsVisionResolution,
  fitToVisionResolution,
} from "./vision-fit.js";

/**
 * Formats the harnesses can display inline everywhere: the Cursor harness
 * re-sniffs magic bytes and recognizes ONLY PNG and JPEG (the deep-agent
 * harness also takes WebP/GIF). Anything else that must ride as pixels is
 * re-encoded to PNG so a Safari TIFF or Chrome WebP paste is not invisible
 * on one harness.
 */
const UNIVERSAL_VISION_TYPES = new Set(["image/png", "image/jpeg"]);

/**
 * PNG density (encoded bytes per pixel) above which content is treated as
 * photographic and re-encoded as JPEG instead.
 *
 * PNG keeps UI text crisp and compresses flat screenshot content to
 * 0.1-0.5 B/px, but photographic content in PNG runs 1.5-3 B/px and can
 * exceed the runner's 3 MiB inline cap even at the fitted resolution
 * (measured: ~3.4 MB for worst-case noise at 1.15 MP). Density is the
 * content signal — scale-invariant, so small UI images never flip to JPEG
 * just because their absolute sizes are tiny (a pure size ratio fails
 * exactly that way) — and it bounds every kept PNG by construction:
 * 1.15 MP × 1.0 B/px ≈ 1.1 MB, far inside the runner's cap, without this
 * module ever referencing the runner's byte constant.
 */
const PHOTOGRAPHIC_PNG_BYTES_PER_PIXEL = 1.0;
const JPEG_QUALITY = 0.9;

function replaceExtension(name: string, ext: string): string {
  const dotIndex = name.lastIndexOf(".");
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  return `${stem}.${ext}`;
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Bounds a pasted image to the resolution vision providers actually
 * process, re-encoding to a format both harnesses can display inline.
 *
 * - PNG and JPEG within the resolution limits pass through byte-identical
 *   (also guards edit-and-resubmit flows against generation loss).
 * - GIF within the limits passes through untouched — re-encoding would
 *   silently flatten an animation the agent also receives as a file.
 * - Oversized images resize to {@link fitToVisionResolution}; other formats
 *   (WebP, TIFF, BMP…) re-encode even when small, for harness visibility.
 * - Output format: JPEG stays JPEG; everything else prefers PNG (crisp UI
 *   text), switching to JPEG only for photographic content — detected by
 *   PNG byte density, where PNG can exceed the runner's inline byte cap.
 *
 * Never throws; every failure path returns the original file (see module
 * doc). Non-image files are returned unchanged.
 */
export async function prepareImageForVision(file: File): Promise<File> {
  const sourceType = file.type.toLowerCase();
  if (!sourceType.startsWith("image/")) return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    // "from-image" applies EXIF orientation, so a pasted phone photo lands
    // upright instead of sideways (most browsers default to this, older
    // Safari does not).
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  try {
    const needsResize = exceedsVisionResolution(bitmap.width, bitmap.height);
    const isGif = sourceType === "image/gif";

    // Within limits and already displayable everywhere (or an animated GIF,
    // which only the resize case may flatten): leave every byte alone.
    if (!needsResize && (UNIVERSAL_VISION_TYPES.has(sourceType) || isGif)) {
      return file;
    }

    const target = needsResize
      ? fitToVisionResolution(bitmap.width, bitmap.height)
      : { width: bitmap.width, height: bitmap.height };

    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, target.width, target.height);

    let blob: Blob | null;
    let outType: string;

    if (sourceType === "image/jpeg") {
      outType = "image/jpeg";
      blob = await encodeCanvas(canvas, outType, JPEG_QUALITY);
    } else {
      const png = await encodeCanvas(canvas, "image/png");
      const pngDensity = png ? png.size / (target.width * target.height) : Infinity;

      if (png && pngDensity <= PHOTOGRAPHIC_PNG_BYTES_PER_PIXEL) {
        outType = "image/png";
        blob = png;
      } else {
        // Photographic content (or a failed PNG encode): take JPEG. JPEG
        // cannot represent alpha, so composite onto white first —
        // destination-over paints beneath the already-drawn image, and the
        // alpha-preserving PNG encode above is already done.
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, target.width, target.height);
        const jpeg = await encodeCanvas(canvas, "image/jpeg", JPEG_QUALITY);

        blob = jpeg ?? png;
        outType = jpeg ? "image/jpeg" : "image/png";
      }
    }

    if (!blob) return file;

    // A pure resize that somehow grew the file is a regression, not a win:
    // the runner caps bytes, not pixels, so the smaller original is the
    // better payload. (Cross-format re-encodes are exempt — growing a WebP
    // into a PNG is the price of being visible on the Cursor harness.)
    if (outType === sourceType && blob.size >= file.size) return file;

    const extension = outType === "image/jpeg" ? "jpg" : "png";
    const name =
      outType === sourceType ? file.name : replaceExtension(file.name, extension);

    return new File([blob], name, {
      type: outType,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}
