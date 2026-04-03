"use client";

import { motion } from "framer-motion";

/**
 * Pulsing border overlay used across demo scenarios to draw the
 * reader's eye to interactive elements (buttons, nav items, profile).
 *
 * Place inside a `position: relative` parent and gate with a boolean:
 *
 *     {highlighted && <PulseHighlight />}
 */
export function PulseHighlight() {
  return (
    <motion.span
      className="absolute inset-0 rounded-md border border-foreground"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 0.5, 0] }}
      transition={{
        duration: 1.2,
        repeat: Infinity,
        ease: "easeInOut",
      }}
      aria-hidden
    />
  );
}
