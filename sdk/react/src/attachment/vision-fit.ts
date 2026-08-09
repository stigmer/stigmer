/**
 * Resolution policy for images attached to agent executions — the pure math
 * behind {@link prepareImageForVision}.
 *
 * Vision providers cap what they will actually look at: Anthropic's standard
 * tier downscales anything beyond a 1568 px long edge or ~1.15 megapixels
 * before the model sees it (OpenAI's high-detail tiling lands in the same
 * range). Shrinking to that ceiling in the browser is therefore
 * quality-neutral — the provider would do it anyway — while cutting a 4-10 MB
 * screenshot paste to a few hundred KB before it ever hits the wire.
 *
 * Deliberately NOT named "budget": in this codebase *vision budget* means the
 * runner's per-turn byte/count budget (`VisionBudget` in the runner's
 * `shared/attachment-vision.ts`, 3 MiB per image raw). That byte cap stays
 * the runner's concern alone; this module bounds pixels, the provider's
 * concern. Two limits, one owner each, no constants to drift.
 */

/**
 * Maximum long-edge length, mirroring Anthropic's standard-tier limit.
 * @see https://platform.claude.com/docs/en/build-with-claude/vision
 */
export const MAX_VISION_LONG_EDGE_PX = 1568;

/**
 * Maximum total pixels, mirroring Anthropic's standard-tier visual-token
 * ceiling (1568 tokens ≈ 1.15 megapixels). For nearly all photos and
 * screenshots this — not the edge limit — is the binding constraint: a
 * 1920×1080 screenshot fits the edge limit but still resizes to 1456×819.
 */
export const MAX_VISION_PIXELS = 1_150_000;

/** Integer pixel dimensions produced by {@link fitToVisionResolution}. */
export interface VisionFitSize {
  readonly width: number;
  readonly height: number;
}

/**
 * True when an image of these dimensions would be downscaled by the
 * provider — i.e. when resizing it ourselves loses nothing.
 */
export function exceedsVisionResolution(width: number, height: number): boolean {
  return (
    width * height > MAX_VISION_PIXELS ||
    Math.max(width, height) > MAX_VISION_LONG_EDGE_PX
  );
}

/**
 * The largest size that fits both vision limits while preserving aspect
 * ratio. Never upscales: dimensions already within the limits come back
 * unchanged. Mirrors Anthropic's published "max API fit" computation.
 *
 * Degenerate inputs (zero, negative, or non-finite dimensions) come back
 * unchanged — the caller's decode has already failed or will fail, and this
 * module never turns a bad input into a crash.
 */
export function fitToVisionResolution(width: number, height: number): VisionFitSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width, height };
  }
  if (!exceedsVisionResolution(width, height)) {
    return { width, height };
  }

  const aspect = width / height;

  // Largest size under the pixel ceiling at this aspect ratio.
  let fitHeight = Math.sqrt(MAX_VISION_PIXELS / aspect);
  let fitWidth = fitHeight * aspect;

  // The edge limit takes over only for extreme aspect ratios (panoramas,
  // tall phone screenshots), where the pixel-fitted size still has a long
  // edge beyond the cap.
  if (Math.max(fitWidth, fitHeight) > MAX_VISION_LONG_EDGE_PX) {
    if (fitWidth >= fitHeight) {
      fitWidth = MAX_VISION_LONG_EDGE_PX;
      fitHeight = fitWidth / aspect;
    } else {
      fitHeight = MAX_VISION_LONG_EDGE_PX;
      fitWidth = fitHeight * aspect;
    }
  }

  return {
    width: Math.max(1, Math.floor(Math.min(fitWidth, width))),
    height: Math.max(1, Math.floor(Math.min(fitHeight, height))),
  };
}
