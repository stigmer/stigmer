/**
 * Animation Design System for Stigmer
 *
 * Centralized, type-safe animation configuration.
 * All motion components consume these variants and transitions.
 *
 * Design Principles:
 * - GPU-accelerated properties only (transform, opacity)
 * - Composable: variants separate from transitions
 * - Type-safe: full inference with `as const`
 * - Accessible: works with useReducedMotion
 */

import type { Variants, Transition } from "framer-motion";

// =============================================================================
// VARIANT DEFINITIONS
// Animation states for different motion patterns
// =============================================================================

/**
 * Fade in with upward motion - the workhorse entrance animation.
 * Use for: cards, text blocks, images entering viewport.
 */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/**
 * Fade in with downward motion.
 * Use for: dropdown menus, tooltips, elements entering from above.
 */
export const fadeInDown: Variants = {
  hidden: { opacity: 0, y: -20 },
  visible: { opacity: 1, y: 0 },
};

/**
 * Simple fade - no translation.
 * Use for: overlays, backdrops, subtle reveals.
 */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

/**
 * Scale in from slightly smaller.
 * Use for: modals, cards with emphasis, focused elements.
 */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
};

/**
 * Slide in from right with exit animation.
 * Use for: side drawers, mobile menus, panels.
 */
export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 50 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 50 },
};

/**
 * Slide in from left with exit animation.
 * Use for: side panels opening from left.
 */
export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -50 },
  visible: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -50 },
};

/**
 * Slide in from right (full panel width) for mobile menus.
 * Use for: mobile navigation drawers.
 */
export const slideInRightFull: Variants = {
  hidden: { x: "100%" },
  visible: { x: 0 },
  exit: { x: "100%" },
};

/**
 * Backdrop fade for overlays.
 * Use for: modal backdrops, menu overlays.
 */
export const backdropFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

// =============================================================================
// STAGGER CONTAINERS
// Parent variants that orchestrate child animations
// =============================================================================

/**
 * Container for staggered children - standard timing.
 * Use for: feature grids, lists, card collections.
 */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
};

/**
 * Container with faster stagger - for dense lists.
 * Use for: navigation items, quick lists.
 */
export const staggerContainerFast: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
};

/**
 * Container with slower stagger - for emphasis.
 * Use for: hero sections, important content.
 */
export const staggerContainerSlow: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.2,
    },
  },
};

// =============================================================================
// TRANSITION PRESETS
// Reusable timing and easing configurations
// =============================================================================

/**
 * Transition presets for consistent motion feel.
 * Use these with variants for complete animations.
 */
export const transitions = {
  /** Spring physics - natural, bouncy feel */
  spring: {
    type: "spring",
    stiffness: 300,
    damping: 30,
  } as Transition,

  /** Bouncier spring - more playful */
  springBouncy: {
    type: "spring",
    stiffness: 400,
    damping: 25,
  } as Transition,

  /** Gentle spring - subtle, professional */
  springGentle: {
    type: "spring",
    stiffness: 200,
    damping: 30,
  } as Transition,

  /** Smooth easing - standard entrance */
  smooth: {
    duration: 0.4,
    ease: [0.25, 0.1, 0.25, 1],
  } as Transition,

  /** Fast easing - quick interactions */
  fast: {
    duration: 0.2,
    ease: "easeOut",
  } as Transition,

  /** Slow easing - dramatic reveals */
  slow: {
    duration: 0.6,
    ease: [0.25, 0.1, 0.25, 1],
  } as Transition,

  /** Menu transition - optimized for drawers */
  menu: {
    type: "spring",
    stiffness: 400,
    damping: 40,
  } as Transition,
} as const;

// =============================================================================
// DURATION CONSTANTS
// Synchronized with CSS custom properties in globals.css
// =============================================================================

/**
 * Duration constants in seconds.
 * These mirror the CSS variables for consistency.
 */
export const durations = {
  instant: 0.1,
  fast: 0.15,
  normal: 0.3,
  slow: 0.5,
  slower: 0.8,
} as const;

// =============================================================================
// VIEWPORT SETTINGS
// Reusable viewport configurations for whileInView
// =============================================================================

/**
 * Viewport settings for scroll-triggered animations.
 */
export const viewportSettings = {
  /** Standard - animate once when 100px into view */
  standard: { once: true, margin: "-100px" },

  /** Eager - animate as soon as visible */
  eager: { once: true, margin: "0px" },

  /** Lazy - animate when well into view */
  lazy: { once: true, margin: "-200px" },

  /** Repeat - re-animate on every scroll */
  repeat: { once: false, margin: "-100px" },
} as const;
