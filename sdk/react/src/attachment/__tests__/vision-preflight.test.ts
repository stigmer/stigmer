import { describe, it, expect } from "vitest";
import {
  assessVisionPreflight,
  visionPreflightMessage,
  type VisionPreflightAttachment,
} from "../vision-preflight";
import type { ModelInfo, VisionLimits } from "../../models/registry";

/** The production budget the registry advertises (3 MiB / 4 MiB / 10). */
const LIMITS: VisionLimits = {
  maxImageBytes: 3 * 1024 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
  maxImages: 10,
};

function image(name: string, sizeBytes: number, contentType = "image/png"): VisionPreflightAttachment {
  return { name, sizeBytes, contentType };
}

function model(overrides?: Partial<ModelInfo>): ModelInfo {
  return {
    modelId: "test-model",
    provider: "anthropic",
    displayName: "Test Model",
    shortDescription: "",
    speedTier: "fast",
    costTier: "standard",
    harness: "native",
    featured: false,
    serviceTiers: [],
    ...overrides,
  };
}

describe("assessVisionPreflight — tri-state silence", () => {
  it("warns about nothing when limits are absent (older server)", () => {
    const result = assessVisionPreflight([image("huge.png", 50 * 1024 * 1024)], {
      model: model(),
    });
    expect(result.warnings).toEqual([]);
    expect(result.modelCannotSeeImages).toBe(false);
  });

  it("stays silent on an unassessed model (visionCapability undefined)", () => {
    const result = assessVisionPreflight([image("a.png", 100)], {
      model: model(),
      limits: LIMITS,
    });
    expect(result.warnings).toEqual([]);
  });

  it("never treats an unknown model as blind", () => {
    const result = assessVisionPreflight([image("a.png", 100)], { limits: LIMITS });
    expect(result.modelCannotSeeImages).toBe(false);
  });

  it("returns no warnings for zero attachments", () => {
    expect(assessVisionPreflight([], { model: model(), limits: LIMITS }).warnings).toEqual([]);
  });
});

describe("assessVisionPreflight — vision candidates", () => {
  it("ignores non-image attachments entirely, even huge ones", () => {
    const result = assessVisionPreflight(
      [
        { name: "big.pdf", sizeBytes: 50 * 1024 * 1024, contentType: "application/pdf" },
        { name: "big.zip", sizeBytes: 50 * 1024 * 1024, contentType: "application/zip" },
      ],
      { model: model({ visionCapability: false }), limits: LIMITS },
    );
    expect(result.warnings).toEqual([]);
    expect(result.modelCannotSeeImages).toBe(false);
  });

  it("ignores SVG — image/* but not a runner vision type", () => {
    const result = assessVisionPreflight(
      [image("diagram.svg", 50 * 1024 * 1024, "image/svg+xml")],
      { model: model(), limits: LIMITS },
    );
    expect(result.warnings).toEqual([]);
  });

  it("assesses all four runner vision types, case-insensitively", () => {
    const oversized = LIMITS.maxImageBytes + 1;
    const result = assessVisionPreflight(
      [
        image("a.png", oversized, "image/png"),
        image("b.jpg", oversized, "image/JPEG"),
        image("c.webp", oversized, "image/webp"),
        image("d.gif", oversized, "image/gif"),
      ],
      { limits: LIMITS },
    );
    expect(result.warnings.map((w) => w.reason)).toEqual([
      "too_large", "too_large", "too_large", "too_large",
    ]);
  });
});

describe("assessVisionPreflight — per-image cap (too_large)", () => {
  it("accepts an image exactly at the cap", () => {
    const result = assessVisionPreflight([image("edge.png", LIMITS.maxImageBytes)], {
      limits: LIMITS,
    });
    expect(result.warnings).toEqual([]);
  });

  it("degrades an image one byte over the cap", () => {
    const result = assessVisionPreflight([image("over.png", LIMITS.maxImageBytes + 1)], {
      limits: LIMITS,
    });
    expect(result.warnings).toEqual([
      { name: "over.png", sizeBytes: LIMITS.maxImageBytes + 1, reason: "too_large" },
    ]);
  });

  it("mirrors the production regression: a 3.59 MiB PNG warns", () => {
    // The prod-verified case from stigmer/stigmer#365 — this image uploaded
    // fine and then surprised the user with a disclosure after the turn.
    const bytes = Math.round(3.59 * 1024 * 1024);
    const result = assessVisionPreflight([image("photo.png", bytes)], { limits: LIMITS });
    expect(result.warnings[0]?.reason).toBe("too_large");
  });
});

describe("assessVisionPreflight — per-turn budget (budget_exhausted)", () => {
  it("replicates the runner's admission: an oversized image does NOT consume budget", () => {
    // 3.5 MiB is over the per-image cap (degraded, not counted); the two
    // 1.9 MiB images then fit the 4 MiB total exactly like the runner
    // would admit them. A naive sum (7.3 MiB) would wrongly warn on all.
    const result = assessVisionPreflight(
      [
        image("oversized.png", 3.5 * 1024 * 1024),
        image("ok-1.png", 1.9 * 1024 * 1024),
        image("ok-2.png", 1.9 * 1024 * 1024),
      ],
      { limits: LIMITS },
    );
    expect(result.warnings).toEqual([
      { name: "oversized.png", sizeBytes: 3.5 * 1024 * 1024, reason: "too_large" },
    ]);
  });

  it("degrades the image that would cross the total-byte budget, in attachment order", () => {
    const twoMib = 2 * 1024 * 1024;
    const result = assessVisionPreflight(
      [image("a.png", twoMib), image("b.png", twoMib), image("c.png", twoMib)],
      { limits: LIMITS },
    );
    // a (2 MiB) + b (2 MiB) = 4 MiB exactly; c would cross.
    expect(result.warnings).toEqual([
      { name: "c.png", sizeBytes: twoMib, reason: "budget_exhausted" },
    ]);
  });

  it("degrades images past the count cap", () => {
    const tiny = 1024;
    const images = Array.from({ length: 12 }, (_, i) => image(`img-${i}.png`, tiny));
    const result = assessVisionPreflight(images, { limits: LIMITS });
    expect(result.warnings.map((w) => w.name)).toEqual(["img-10.png", "img-11.png"]);
    expect(result.warnings.every((w) => w.reason === "budget_exhausted")).toBe(true);
  });

  it("admits a smaller later image after an earlier refusal (runner semantics: sequential offers, no reservation)", () => {
    // The runner offers every image in order and never reserves budget for
    // a refused one; the preflight must not be cleverer or dumber than the
    // enforcement it predicts.
    const result = assessVisionPreflight(
      [
        image("big.png", 3 * 1024 * 1024),
        image("medium.png", 2 * 1024 * 1024), // 3+2 > 4 → refused
        image("small.png", 512 * 1024),       // 3+0.5 ≤ 4 → admitted
      ],
      { limits: LIMITS },
    );
    expect(result.warnings).toEqual([
      { name: "medium.png", sizeBytes: 2 * 1024 * 1024, reason: "budget_exhausted" },
    ]);
  });
});

describe("assessVisionPreflight — blind model (model_no_vision)", () => {
  it("short-circuits the byte math: every image warns model_no_vision, sizes irrelevant", () => {
    const result = assessVisionPreflight(
      [image("tiny.png", 10), image("huge.png", 50 * 1024 * 1024)],
      { model: model({ visionCapability: false }), limits: LIMITS },
    );
    expect(result.modelCannotSeeImages).toBe(true);
    expect(result.warnings).toEqual([
      { name: "tiny.png", sizeBytes: 10, reason: "model_no_vision" },
      { name: "huge.png", sizeBytes: 50 * 1024 * 1024, reason: "model_no_vision" },
    ]);
  });

  it("applies the capability verdict even without limits (older server)", () => {
    const result = assessVisionPreflight([image("a.png", 10)], {
      model: model({ visionCapability: false }),
    });
    expect(result.modelCannotSeeImages).toBe(true);
  });

  it("an explicitly sighted model gets the normal byte assessment", () => {
    const result = assessVisionPreflight([image("a.png", LIMITS.maxImageBytes + 1)], {
      model: model({ visionCapability: true }),
      limits: LIMITS,
    });
    expect(result.modelCannotSeeImages).toBe(false);
    expect(result.warnings[0]?.reason).toBe("too_large");
  });
});

describe("visionPreflightMessage", () => {
  it("returns null for a clean preflight", () => {
    expect(
      visionPreflightMessage({ warnings: [], modelCannotSeeImages: false }),
    ).toBeNull();
  });

  it("leads with the model for a blind-model preflight, never file advice", () => {
    const preflight = assessVisionPreflight([image("a.png", 10)], {
      model: model({ visionCapability: false, displayName: "Kimi K3" }),
      limits: LIMITS,
    });
    const message = visionPreflightMessage(preflight, {
      limits: LIMITS,
      modelDisplayName: "Kimi K3",
    });
    expect(message).toBe(
      "Kimi K3 can't view images — attached images will reach the agent as files only.",
    );
  });

  it("names a single oversized file with its size and the actual cap", () => {
    const preflight = assessVisionPreflight(
      [image("screenshot.png", Math.round(3.6 * 1024 * 1024))],
      { limits: LIMITS },
    );
    const message = visionPreflightMessage(preflight, { limits: LIMITS });
    expect(message).toBe(
      "screenshot.png (3.6 MB) exceeds the 3.0 MB inline-image limit and will reach the agent as a file, not an image.",
    );
  });

  it("names two oversized files, then switches to a count for more", () => {
    const over = LIMITS.maxImageBytes + 1;
    const two = assessVisionPreflight(
      [image("a.png", over), image("b.png", over)],
      { limits: LIMITS },
    );
    expect(visionPreflightMessage(two, { limits: LIMITS })).toContain(
      "a.png and b.png exceed",
    );

    const three = assessVisionPreflight(
      [image("a.png", over), image("b.png", over), image("c.png", over)],
      { limits: LIMITS },
    );
    expect(visionPreflightMessage(three, { limits: LIMITS })).toContain(
      "3 images exceed",
    );
  });

  it("explains the per-turn budget for budget_exhausted", () => {
    const twoMib = 2 * 1024 * 1024;
    const preflight = assessVisionPreflight(
      [image("a.png", twoMib), image("b.png", twoMib), image("c.png", twoMib)],
      { limits: LIMITS },
    );
    const message = visionPreflightMessage(preflight, { limits: LIMITS });
    expect(message).toBe(
      "c.png is over this turn's inline-image budget (10 images, 4.0 MB total) and will reach the agent as a file.",
    );
  });

  it("joins mixed too_large and budget_exhausted reasons into one line", () => {
    const preflight = {
      warnings: [
        { name: "big.png", sizeBytes: 4 * 1024 * 1024, reason: "too_large" as const },
        { name: "late.png", sizeBytes: 1024, reason: "budget_exhausted" as const },
      ],
      modelCannotSeeImages: false,
    };
    const message = visionPreflightMessage(preflight, { limits: LIMITS });
    expect(message).toContain("big.png");
    expect(message).toContain("late.png");
    expect(message).toContain("; ");
  });

  it("degrades copy gracefully when limits are unknown", () => {
    const preflight = {
      warnings: [
        { name: "big.png", sizeBytes: 4 * 1024 * 1024, reason: "too_large" as const },
      ],
      modelCannotSeeImages: false,
    };
    const message = visionPreflightMessage(preflight);
    expect(message).toBe(
      "big.png (4.0 MB) exceeds the inline-image size limit and will reach the agent as a file, not an image.",
    );
  });

  it("falls back to generic wording when the blind model has no display name", () => {
    const preflight = {
      warnings: [{ name: "a.png", sizeBytes: 10, reason: "model_no_vision" as const }],
      modelCannotSeeImages: true,
    };
    expect(visionPreflightMessage(preflight)).toBe(
      "The selected model can't view images — attached images will reach the agent as files only.",
    );
  });
});
