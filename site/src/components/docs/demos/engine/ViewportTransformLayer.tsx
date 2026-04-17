"use client";

import { type ReactNode } from "react";
import { motion } from "framer-motion";

/** Viewport transform state produced by `useStepInteractions`. */
export interface ViewportTransform {
  scale: number;
  x: number;
  y: number;
}

/** The identity transform — no zoom, no translation. */
export const VIEWPORT_TRANSFORM_IDENTITY: Readonly<ViewportTransform> = {
  scale: 1,
  x: 0,
  y: 0,
};

interface ViewportTransformLayerProps {
  children: ReactNode;
  transform: ViewportTransform;
}

const ZOOM_SPRING = {
  type: "spring",
  stiffness: 100,
  damping: 20,
  mass: 0.8,
} as const;

/**
 * Animated transform layer for viewport zoom/pan transitions.
 *
 * Wraps demo content in a Framer Motion container that smoothly
 * animates `scale` + `translate` to zoom into or pan across regions
 * of the demo. The transform uses `transformOrigin: "0 0"` so that
 * scale and translate compose predictably (the hook computes
 * translate values assuming top-left origin).
 *
 * When `scale !== 1`, applies `overflow: hidden` to clip the
 * zoomed content to the viewport bounds. At identity transform
 * (`scale: 1, x: 0, y: 0`) overflow is unrestricted so portaled
 * content (dropdowns, tooltips) is not clipped.
 *
 * **Critical invariant**: The `Cursor` component must be a sibling
 * of this layer, NOT a child. The cursor uses `position: absolute`
 * relative to the shared container and relies on
 * `getBoundingClientRect()` to find target elements. Elements
 * inside this layer report their visual (post-transform) positions
 * via `getBoundingClientRect`, which the cursor uses directly.
 * Placing the cursor inside the transform would double-apply the
 * transform to its positioning.
 */
export function ViewportTransformLayer({
  children,
  transform,
}: ViewportTransformLayerProps) {
  const isZoomed = transform.scale !== 1 || transform.x !== 0 || transform.y !== 0;

  return (
    <div className={isZoomed ? "overflow-hidden" : undefined}>
      <motion.div
        animate={{ scale: transform.scale, x: transform.x, y: transform.y }}
        transition={ZOOM_SPRING}
        style={{ transformOrigin: "0 0" }}
      >
        {children}
      </motion.div>
    </div>
  );
}
