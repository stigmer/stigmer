import { describe, it, expect } from "vitest";
import {
  MAX_VISION_LONG_EDGE_PX,
  MAX_VISION_PIXELS,
  exceedsVisionResolution,
  fitToVisionResolution,
} from "../vision-fit.js";

describe("exceedsVisionResolution", () => {
  it("is false at and below both limits", () => {
    expect(exceedsVisionResolution(200, 200)).toBe(false);
    expect(exceedsVisionResolution(1000, 1000)).toBe(false);
    // Exactly at the pixel ceiling.
    expect(exceedsVisionResolution(1000, 1150)).toBe(false);
    // Exactly at the edge ceiling, pixels under budget.
    expect(exceedsVisionResolution(MAX_VISION_LONG_EDGE_PX, 700)).toBe(false);
  });

  it("is true when either limit is exceeded", () => {
    expect(exceedsVisionResolution(1920, 1080)).toBe(true); // pixels
    expect(exceedsVisionResolution(MAX_VISION_LONG_EDGE_PX + 1, 10)).toBe(true); // edge
  });
});

describe("fitToVisionResolution", () => {
  it("returns within-limit dimensions unchanged (never upscales)", () => {
    expect(fitToVisionResolution(200, 200)).toEqual({ width: 200, height: 200 });
    expect(fitToVisionResolution(1000, 1000)).toEqual({ width: 1000, height: 1000 });
    expect(fitToVisionResolution(1000, 1150)).toEqual({ width: 1000, height: 1150 });
  });

  it("returns degenerate dimensions unchanged instead of crashing", () => {
    expect(fitToVisionResolution(0, 100)).toEqual({ width: 0, height: 100 });
    expect(fitToVisionResolution(-5, 100)).toEqual({ width: -5, height: 100 });
    expect(fitToVisionResolution(Number.NaN, 100)).toEqual({
      width: Number.NaN,
      height: 100,
    });
    expect(fitToVisionResolution(Number.POSITIVE_INFINITY, 100)).toEqual({
      width: Number.POSITIVE_INFINITY,
      height: 100,
    });
  });

  // Invariant checks across representative shapes: exact pixel values are
  // an implementation detail of the fitting math, but every output must
  // satisfy the published limits, preserve aspect, and never upscale.
  const shapes: Array<[string, number, number]> = [
    ["1080p screenshot", 1920, 1080],
    ["4K screenshot", 3840, 2160],
    ["Retina laptop screenshot", 2880, 1800],
    ["portrait phone screenshot", 1170, 2532],
    ["3:2 camera photo", 6000, 4000],
    ["square", 4000, 4000],
    ["wide panorama (edge limit binds)", 10000, 300],
    ["tall receipt scan (edge limit binds)", 300, 10000],
    ["just over the pixel ceiling", 1073, 1073],
  ];

  for (const [label, width, height] of shapes) {
    it(`fits ${label} (${width}x${height}) within all limits`, () => {
      const fitted = fitToVisionResolution(width, height);

      // Both published limits hold.
      expect(fitted.width * fitted.height).toBeLessThanOrEqual(MAX_VISION_PIXELS);
      expect(Math.max(fitted.width, fitted.height)).toBeLessThanOrEqual(
        MAX_VISION_LONG_EDGE_PX,
      );

      // Never upscales, always yields drawable integer dimensions.
      expect(fitted.width).toBeLessThanOrEqual(width);
      expect(fitted.height).toBeLessThanOrEqual(height);
      expect(fitted.width).toBeGreaterThanOrEqual(1);
      expect(fitted.height).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(fitted.width)).toBe(true);
      expect(Number.isInteger(fitted.height)).toBe(true);

      // Aspect ratio preserved within integer-rounding tolerance.
      const originalAspect = width / height;
      const fittedAspect = fitted.width / fitted.height;
      expect(Math.abs(fittedAspect - originalAspect) / originalAspect).toBeLessThan(
        0.02,
      );
    });
  }

  it("uses most of the pixel budget rather than over-shrinking", () => {
    // The fit should land close under the ceiling, not waste resolution:
    // a 4K screenshot must keep at least 90% of the allowed pixels.
    const fitted = fitToVisionResolution(3840, 2160);
    expect(fitted.width * fitted.height).toBeGreaterThan(MAX_VISION_PIXELS * 0.9);
  });
});
