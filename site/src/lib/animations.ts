/**
 * Animation Design System
 *
 * Centralized, type-safe animation configuration for Stigmer website.
 * All animations use compositor-only properties (transform, opacity) for
 * optimal performance. Designed to work with framer-motion.
 *
 * @example
 * import { fadeInUp, transitions, viewportOnce } from "@/lib/animations";
 *
 * <motion.div
 *   initial="hidden"
 *   whileInView="visible"
 *   viewport={viewportOnce}
 *   variants={fadeInUp}
 *   transition={transitions.smooth}
 * >
 *   Content
 * </motion.div>
 */

import type { Variants, Transition } from "framer-motion";

// =============================================================================
// ENTRANCE ANIMATIONS
// =============================================================================

/**
 * Simple opacity fade.
 */
export const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
} as const satisfies Variants;

/**
 * Fade in while sliding up - most common entrance animation.
 */
export const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
} as const satisfies Variants;

/**
 * Fade in while sliding down.
 */
export const fadeInDown = {
  hidden: { opacity: 0, y: -20 },
  visible: { opacity: 1, y: 0 },
} as const satisfies Variants;

/**
 * Fade in while sliding from left.
 */
export const fadeInLeft = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 },
} as const satisfies Variants;

/**
 * Fade in while sliding from right.
 */
export const fadeInRight = {
  hidden: { opacity: 0, x: 20 },
  visible: { opacity: 1, x: 0 },
} as const satisfies Variants;

/**
 * Scale up with fade - good for cards and modals.
 */
export const scaleIn = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
} as const satisfies Variants;

/**
 * Larger scale animation - for hero elements.
 */
export const scaleInLarge = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1 },
} as const satisfies Variants;

// =============================================================================
// STAGGER CONTAINERS
// =============================================================================

/**
 * Standard stagger container for lists/grids.
 * Children animate with 100ms delay between each.
 */
export const staggerContainer = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2,
    },
  },
} as const satisfies Variants;

/**
 * Faster stagger for smaller elements.
 * Children animate with 50ms delay between each.
 */
export const staggerFast = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
} as const satisfies Variants;

/**
 * Slower stagger for dramatic effect.
 * Children animate with 150ms delay between each.
 */
export const staggerSlow = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.3,
    },
  },
} as const satisfies Variants;

// =============================================================================
// TRANSITION PRESETS
// =============================================================================

/**
 * Pre-configured transitions for consistent animation feel.
 *
 * - spring: Bouncy, natural feel for interactive elements
 * - smooth: Elegant ease for content reveals
 * - fast: Quick feedback for micro-interactions
 * - slow: Dramatic effect for hero sections
 */
export const transitions = {
  /** Bouncy spring - good for interactive elements */
  spring: {
    type: "spring",
    stiffness: 300,
    damping: 30,
  } as Transition,

  /** Smooth cubic bezier - elegant content reveals */
  smooth: {
    duration: 0.4,
    ease: [0.25, 0.1, 0.25, 1],
  } as Transition,

  /** Fast easeOut - micro-interactions */
  fast: {
    duration: 0.2,
    ease: "easeOut",
  } as Transition,

  /** Slow ease - dramatic hero animations */
  slow: {
    duration: 0.6,
    ease: [0.25, 0.1, 0.25, 1],
  } as Transition,

  /** Very slow - for background/ambient effects */
  slower: {
    duration: 0.8,
    ease: [0.25, 0.1, 0.25, 1],
  } as Transition,
} as const;

// =============================================================================
// VIEWPORT CONFIGURATION
// =============================================================================

/**
 * Standard viewport config - animate once when element enters view.
 * Uses negative margin to trigger slightly before fully visible.
 */
export const viewportOnce = {
  once: true,
  margin: "-100px",
} as const;

/**
 * Viewport config for smaller margins (closer to edge trigger).
 */
export const viewportOnceNear = {
  once: true,
  margin: "-50px",
} as const;

/**
 * Viewport config that re-animates on every scroll.
 * Use sparingly - only for decorative elements.
 */
export const viewportAlways = {
  once: false,
  margin: "-50px",
} as const;

// =============================================================================
// HOVER & TAP ANIMATIONS
// =============================================================================

/**
 * Subtle scale on hover - good for cards.
 */
export const hoverScale = {
  scale: 1.02,
  transition: transitions.fast,
} as const;

/**
 * Larger scale on hover - for CTAs.
 */
export const hoverScaleLarge = {
  scale: 1.05,
  transition: transitions.fast,
} as const;

/**
 * Lift effect on hover (scale + slight move up).
 */
export const hoverLift = {
  scale: 1.02,
  y: -4,
  transition: transitions.fast,
} as const;

/**
 * Glow effect on hover - uses CSS variable.
 */
export const hoverGlow = {
  boxShadow: "0 0 20px hsl(var(--primary) / 0.3)",
  transition: transitions.fast,
} as const;

/**
 * Press/tap feedback - slight scale down.
 */
export const tapScale = {
  scale: 0.98,
} as const;

/**
 * Stronger press feedback for buttons.
 */
export const tapScaleStrong = {
  scale: 0.95,
} as const;

// =============================================================================
// REDUCED MOTION SUPPORT
// =============================================================================

/**
 * Returns empty motion props when user prefers reduced motion.
 * Use with framer-motion's useReducedMotion hook.
 *
 * @example
 * const prefersReducedMotion = useReducedMotion();
 * const motionProps = getMotionProps(prefersReducedMotion);
 *
 * <motion.div
 *   initial="hidden"
 *   whileInView="visible"
 *   variants={fadeInUp}
 *   {...motionProps}
 * />
 */
export function getMotionProps(prefersReducedMotion: boolean | null) {
  if (prefersReducedMotion) {
    return {
      initial: undefined,
      animate: undefined,
      whileInView: undefined,
      variants: undefined,
      transition: undefined,
    };
  }
  return {};
}

/**
 * Returns a transition that respects reduced motion preference.
 * Instantly completes animation when reduced motion is preferred.
 */
export function getTransition(
  prefersReducedMotion: boolean | null,
  transition: Transition = transitions.smooth
): Transition {
  if (prefersReducedMotion) {
    return { duration: 0 };
  }
  return transition;
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

/** Type for animation variant objects */
export type AnimationVariant = typeof fadeInUp;

/** Type for transition preset keys */
export type TransitionPreset = keyof typeof transitions;

/** Type for viewport configuration */
export type ViewportConfig = typeof viewportOnce;
