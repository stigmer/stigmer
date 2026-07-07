import { converter, parse, wcagContrast, type Rgb } from "culori";

/**
 * Color math for the token contrast audit, backed by culori.
 *
 * All comparisons happen on *composited* colors: a translucent token (e.g.
 * the dark-mode `--stgm-border: oklch(1 0 0 / 14%)`) is first blended over
 * its surface the way a browser paints it, so the audit measures what the
 * user actually sees.
 */

const toRgb = converter("rgb");
const toOklch = converter("oklch");

/** Parse a CSS color token value; throws on non-color values. */
export function parseColor(value: string): Rgb {
  const parsed = parse(value);
  if (!parsed) {
    throw new Error(`Not a parseable CSS color: "${value}"`);
  }
  return toRgb(parsed);
}

/** True when the token value is a color (vs. a length, shadow, font, ...). */
export function isColorValue(value: string): boolean {
  return parse(value) !== undefined;
}

/**
 * Composite a possibly-translucent foreground over an opaque backdrop
 * (simple source-over in sRGB, matching browser compositing).
 */
export function compositeOver(foreground: Rgb, backdrop: Rgb): Rgb {
  const alpha = foreground.alpha ?? 1;
  if (alpha >= 1) return foreground;
  return {
    mode: "rgb",
    r: foreground.r * alpha + backdrop.r * (1 - alpha),
    g: foreground.g * alpha + backdrop.g * (1 - alpha),
    b: foreground.b * alpha + backdrop.b * (1 - alpha),
    alpha: 1,
  };
}

/**
 * WCAG 2.1 contrast ratio between two token values.
 *
 * A translucent *background* (e.g. the dark-mode `--stgm-border`) must be
 * composited over the surface it actually paints on — pass that surface as
 * `backdropValue`. The foreground is then composited over the resolved
 * background. Omitting `backdropValue` for a translucent background is a
 * caller error and throws, so no pair silently measures against nothing.
 */
export function contrastRatio(
  foregroundValue: string,
  backgroundValue: string,
  backdropValue?: string,
): number {
  const rawBackground = parseColor(backgroundValue);
  if ((rawBackground.alpha ?? 1) < 1 && backdropValue === undefined) {
    throw new Error(
      `Background "${backgroundValue}" is translucent — pass the surface it renders over as backdropValue`,
    );
  }
  const background = backdropValue
    ? compositeOver(rawBackground, parseColor(backdropValue))
    : rawBackground;
  const foreground = compositeOver(parseColor(foregroundValue), background);
  return wcagContrast(foreground, background);
}

/**
 * Perceptual lightness difference (OKLCH L, 0..1) between two opaque token
 * values. Used for surface-separation checks where WCAG has no defined
 * threshold.
 */
export function lightnessDelta(valueA: string, valueB: string): number {
  return Math.abs(toOklch(parseColor(valueA)).l - toOklch(parseColor(valueB)).l);
}
