/**
 * Client-side vision preflight — predicts, before a turn is spent, which
 * attached images the runner will refuse to deliver inline and why
 * (stigmer/stigmer#365, stigmer/stigmer#386).
 *
 * The runner is the enforcement authority (`VisionBudget` in its
 * `shared/attachment-vision.ts`); this module is the warning authority.
 * To never warn differently than the runner behaves, it replicates the
 * runner's admission semantics against the SAME data the runner uses:
 *
 * - the byte budget arrives via the registry document's `limits.vision`
 *   block ({@link VisionLimits}) — advertised == enforced;
 * - the model's vision capability arrives via the per-model
 *   `capabilities` block ({@link ModelInfo.visionCapability});
 * - reasons reuse the runner's disclosure vocabulary
 *   (`VisionDegradedReason`), so a warning here and a disclosure in the
 *   agent's reply always tell one story.
 *
 * Tri-state discipline: absent limits or an unassessed model produce NO
 * warnings. A client that cannot know the budget must stay silent, not
 * guess — the runner's own disclosure remains the backstop.
 *
 * Deliberately assessed client-side reasons are a SUBSET of the runner's:
 * `unsupported_format` and `type_mismatch` need magic-byte sniffing that a
 * declared content type cannot honestly stand in for (and pasted images are
 * already normalized by `prepareImageForVision`), so those two remain
 * runner-disclosed only.
 */

import type { ModelInfo, VisionLimits } from "../models/registry.js";
import { formatFileSize } from "./attachment-utils.js";

/**
 * Content types the runner recognizes as vision candidates (its
 * `VisionMimeType` set). Anything else — PDFs, SVGs, archives — rides the
 * normal file story with no inline-vision expectation and no warning.
 */
const VISION_CANDIDATE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/** Minimal attachment shape the preflight needs — pure data, no `File`. */
export interface VisionPreflightAttachment {
  /** Display name used in warning copy (the chip's filename). */
  readonly name: string;
  /** Raw byte size — what the runner's budget counts. */
  readonly sizeBytes: number;
  /** Declared/detected MIME type (`AttachmentEntry.contentType`). */
  readonly contentType: string;
}

/**
 * Why an image will not be viewable inline — the client-assessable subset
 * of the runner's `VisionDegradedReason` vocabulary, same spellings.
 */
export type VisionPreflightReason =
  /** Raw bytes exceed the per-image cap; a smaller re-export would fix it. */
  | "too_large"
  /** Image is fine but the turn's total/count budget is already spent. */
  | "budget_exhausted"
  /** The selected model is explicitly assessed as unable to see images. */
  | "model_no_vision";

/** One image the runner is predicted to degrade, and why. */
export interface VisionPreflightWarning {
  readonly name: string;
  readonly sizeBytes: number;
  readonly reason: VisionPreflightReason;
}

/** Result of {@link assessVisionPreflight}. */
export interface VisionPreflight {
  /** Predicted-degraded images in attachment order. Empty = all clear. */
  readonly warnings: readonly VisionPreflightWarning[];
  /**
   * True when the selected model is explicitly blind (`vision: false`)
   * and at least one image is attached. When set, every image warning
   * carries `model_no_vision` — resending smaller images cannot help, so
   * warning UI should lead with the model, not the files.
   */
  readonly modelCannotSeeImages: boolean;
}

const NO_WARNINGS: VisionPreflight = { warnings: [], modelCannotSeeImages: false };

/** Options for {@link assessVisionPreflight}. */
export interface AssessVisionPreflightOptions {
  /**
   * The model the turn will run on. `undefined` (unknown/still loading)
   * disables the capability verdict, never the byte assessment.
   */
  readonly model?: ModelInfo | undefined;
  /**
   * The advertised byte budget from `useModelRegistry().visionLimits`.
   * `undefined` (older server, still loading) disables the byte
   * assessment, never the capability verdict.
   */
  readonly limits?: VisionLimits | undefined;
}

/**
 * Predict which attached images the runner will degrade this turn.
 *
 * Pure and deterministic — safe to call in render (memoized by callers).
 * Non-image attachments never warn. The byte assessment replicates the
 * runner's sequential admission: an image over the per-image cap is
 * degraded WITHOUT consuming budget; remaining images are admitted in
 * order until the count or total-byte budget is exhausted.
 */
export function assessVisionPreflight(
  attachments: readonly VisionPreflightAttachment[],
  options?: AssessVisionPreflightOptions,
): VisionPreflight {
  const candidates = attachments.filter((a) =>
    VISION_CANDIDATE_TYPES.has(a.contentType.toLowerCase()),
  );
  if (candidates.length === 0) return NO_WARNINGS;

  // The capability gate short-circuits the byte math: on an explicitly
  // blind model no image is deliverable at any size, and mixing byte
  // warnings in would wrongly suggest a smaller resend could help.
  if (options?.model?.visionCapability === false) {
    return {
      warnings: candidates.map((a) => ({
        name: a.name,
        sizeBytes: a.sizeBytes,
        reason: "model_no_vision",
      })),
      modelCannotSeeImages: true,
    };
  }

  const limits = options?.limits;
  if (!limits) return NO_WARNINGS;

  const warnings: VisionPreflightWarning[] = [];
  let acceptedCount = 0;
  let acceptedBytes = 0;

  for (const image of candidates) {
    if (image.sizeBytes > limits.maxImageBytes) {
      warnings.push({ name: image.name, sizeBytes: image.sizeBytes, reason: "too_large" });
      continue;
    }
    if (
      acceptedCount >= limits.maxImages ||
      acceptedBytes + image.sizeBytes > limits.maxTotalBytes
    ) {
      warnings.push({
        name: image.name,
        sizeBytes: image.sizeBytes,
        reason: "budget_exhausted",
      });
      continue;
    }
    acceptedCount += 1;
    acceptedBytes += image.sizeBytes;
  }

  return warnings.length === 0
    ? NO_WARNINGS
    : { warnings, modelCannotSeeImages: false };
}

/** Options for {@link visionPreflightMessage}. */
export interface VisionPreflightMessageOptions {
  /** The advertised budget — names the caps in the copy when present. */
  readonly limits?: VisionLimits | undefined;
  /** Display name of the selected model, for the capability wording. */
  readonly modelDisplayName?: string | undefined;
}

/**
 * One-line human copy for a {@link VisionPreflight} — the client-side twin
 * of the runner's `visionDisclosureLines`, worded for BEFORE the turn
 * ("will arrive as a file") instead of after ("was not viewable").
 *
 * Returns `null` when there is nothing to warn about. Copy rules:
 * - a blind model leads with the model, never the files — no smaller
 *   resend can help, so file-size advice would be dishonest;
 * - `too_large` names the files (up to two, then a count) and the actual
 *   cap, so the fix — export smaller — is self-evident;
 * - `budget_exhausted` explains the per-turn budget, the only fix being
 *   fewer images this turn.
 */
export function visionPreflightMessage(
  preflight: VisionPreflight,
  options?: VisionPreflightMessageOptions,
): string | null {
  if (preflight.warnings.length === 0) return null;

  if (preflight.modelCannotSeeImages) {
    const model = options?.modelDisplayName ?? "The selected model";
    return `${model} can't view images — attached images will reach the agent as files only.`;
  }

  const tooLarge = preflight.warnings.filter((w) => w.reason === "too_large");
  const exhausted = preflight.warnings.filter((w) => w.reason === "budget_exhausted");
  const parts: string[] = [];

  if (tooLarge.length > 0) {
    const capPhrase = options?.limits
      ? `the ${formatFileSize(options.limits.maxImageBytes)} inline-image limit`
      : "the inline-image size limit";
    if (tooLarge.length === 1) {
      const w = tooLarge[0];
      parts.push(
        `${w.name} (${formatFileSize(w.sizeBytes)}) exceeds ${capPhrase} and will reach the agent as a file, not an image`,
      );
    } else if (tooLarge.length === 2) {
      parts.push(
        `${tooLarge[0].name} and ${tooLarge[1].name} exceed ${capPhrase} and will reach the agent as files, not images`,
      );
    } else {
      parts.push(
        `${tooLarge.length} images exceed ${capPhrase} and will reach the agent as files, not images`,
      );
    }
  }

  if (exhausted.length > 0) {
    const budget = options?.limits
      ? `this turn's inline-image budget (${options.limits.maxImages} images, ${formatFileSize(options.limits.maxTotalBytes)} total)`
      : "this turn's inline-image budget";
    parts.push(
      exhausted.length === 1
        ? `${exhausted[0].name} is over ${budget} and will reach the agent as a file`
        : `${exhausted.length} images are over ${budget} and will reach the agent as files`,
    );
  }

  return parts.length === 0 ? null : `${parts.join("; ")}.`;
}
