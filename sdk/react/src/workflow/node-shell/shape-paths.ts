import type { VisualClass } from "../task-type-visual-registry";

/**
 * Inset rectangle defining the safe content area within a node shape.
 * All values are in pixels from the respective edge of the bounding box.
 */
export interface ContentInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Returns an SVG path `d` string for a diamond (rotated square)
 * inscribed within the given bounding box.
 *
 * Vertices at midpoints of each edge: top-center, right-center,
 * bottom-center, left-center.
 */
export function diamondPath(width: number, height: number): string {
  const mx = width / 2;
  const my = height / 2;
  return `M ${mx} 0 L ${width} ${my} L ${mx} ${height} L 0 ${my} Z`;
}

/**
 * Returns an SVG path `d` string for a regular octagon inscribed
 * within the given bounding box. The cut fraction controls how much
 * of each corner is removed.
 */
export function octagonPath(width: number, height: number): string {
  const cut = Math.min(width, height) * 0.29;
  const r = width;
  const b = height;
  return [
    `M ${cut} 0`,
    `L ${r - cut} 0`,
    `L ${r} ${cut}`,
    `L ${r} ${b - cut}`,
    `L ${r - cut} ${b}`,
    `L ${cut} ${b}`,
    `L 0 ${b - cut}`,
    `L 0 ${cut}`,
    `Z`,
  ].join(" ");
}

/**
 * Returns an SVG path `d` string for a circle (or ellipse when w != h)
 * centered within the bounding box. Uses two arc commands.
 */
export function circlePath(width: number, height: number): string {
  const rx = width / 2;
  const ry = height / 2;
  return [
    `M ${rx} 0`,
    `A ${rx} ${ry} 0 1 1 ${rx} ${height}`,
    `A ${rx} ${ry} 0 1 1 ${rx} 0`,
    `Z`,
  ].join(" ");
}

/**
 * Returns an SVG path `d` string for a parallel bar — a wide,
 * low-height rounded rectangle. Corner radius is half the height
 * to produce fully rounded ends.
 */
export function parallelBarPath(width: number, height: number): string {
  const r = Math.min(height / 2, 8);
  return [
    `M ${r} 0`,
    `L ${width - r} 0`,
    `A ${r} ${r} 0 0 1 ${width} ${r}`,
    `L ${width} ${height - r}`,
    `A ${r} ${r} 0 0 1 ${width - r} ${height}`,
    `L ${r} ${height}`,
    `A ${r} ${r} 0 0 1 0 ${height - r}`,
    `L 0 ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0`,
    `Z`,
  ].join(" ");
}

/**
 * Content insets per visual class. Defines the largest rectangle
 * within the shape where text/badges can safely render without
 * being clipped by the shape boundary.
 */
const CONTENT_INSETS: Record<VisualClass, ContentInsets> = {
  "task-card": { top: 8, right: 12, bottom: 8, left: 12 },
  "subworkflow-card": { top: 8, right: 12, bottom: 8, left: 12 },
  "container": { top: 10, right: 12, bottom: 10, left: 12 },
  "terminal-pill": { top: 6, right: 16, bottom: 6, left: 16 },
  "decision-diamond": { top: 35, right: 35, bottom: 35, left: 35 },
  "gate-octagon": { top: 32, right: 32, bottom: 32, left: 32 },
  "event-circle": { top: 20, right: 20, bottom: 20, left: 20 },
  "parallel-bar": { top: 4, right: 16, bottom: 4, left: 16 },
};

/**
 * Returns the content insets for a given visual class.
 * Falls back to task-card insets for unknown values.
 */
export function getContentInsets(visualClass: VisualClass): ContentInsets {
  return CONTENT_INSETS[visualClass] ?? CONTENT_INSETS["task-card"];
}

/**
 * Returns the SVG path `d` string for a non-rectangular visual class.
 * Returns `null` for rectangular visual classes (which use CSS rendering).
 */
export function getShapePath(
  visualClass: VisualClass,
  width: number,
  height: number,
): string | null {
  switch (visualClass) {
    case "decision-diamond":
      return diamondPath(width, height);
    case "gate-octagon":
      return octagonPath(width, height);
    case "event-circle":
      return circlePath(width, height);
    case "parallel-bar":
      return parallelBarPath(width, height);
    default:
      return null;
  }
}

/**
 * Visual classes that use SVG path rendering instead of CSS borders.
 */
export const SVG_SHAPE_CLASSES: ReadonlySet<VisualClass> = new Set([
  "decision-diamond",
  "gate-octagon",
  "event-circle",
  "parallel-bar",
]);
