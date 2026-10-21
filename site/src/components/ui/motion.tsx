"use client";

/**
 * Motion Components for Stigmer
 *
 * Production-grade, accessible animation wrappers built on Framer Motion.
 *
 * Features:
 * - Full TypeScript support with proper generics
 * - Reduced motion honoured by the stylesheet: each reveal is marked
 *   `data-reveal`, and globals.css holds marked elements visible and still
 *   under `prefers-reduced-motion: reduce`. The render never branches on the
 *   preference: the static export is rendered without it, React keeps the
 *   server's attributes when it hydrates, and a plain div rendered in the
 *   browser would leave the exported `opacity: 0` on the page
 *   (components/ui/__tests__/motion.test.tsx)
 * - SSR compatible (no window/document in render)
 * - Composable API with variant overrides
 * - Performance optimized (GPU-only properties)
 *
 * @example
 * // Basic fade-in on scroll
 * <FadeInUp>
 *   <Card>Content</Card>
 * </FadeInUp>
 *
 * @example
 * // Staggered grid animation
 * <StaggerContainer className="grid grid-cols-3 gap-4">
 *   {items.map(item => (
 *     <StaggerItem key={item.id}>
 *       <Card>{item.title}</Card>
 *     </StaggerItem>
 *   ))}
 * </StaggerContainer>
 */

import { forwardRef, type ReactNode, type ComponentPropsWithoutRef } from "react";
import {
  motion,
  AnimatePresence as FramerAnimatePresence,
  type HTMLMotionProps,
  type Variants,
} from "framer-motion";
import {
  fadeInUp,
  fadeIn,
  scaleIn,
  transitions,
  viewportSettings,
} from "@/lib/animations";

// =============================================================================
// RE-EXPORTS
// Convenient access to Framer Motion utilities
// =============================================================================

/**
 * AnimatePresence - enables exit animations for unmounting components.
 * Use this to wrap components that need smooth exit transitions.
 *
 * @example
 * <AnimatePresence mode="wait">
 *   {isOpen && <Modal key="modal" />}
 * </AnimatePresence>
 */
export const AnimatePresence = FramerAnimatePresence;

/**
 * Hook to check if user prefers reduced motion.
 * Use this for custom animation logic.
 *
 * @example
 * const prefersReducedMotion = useReducedMotion();
 * const animationDuration = prefersReducedMotion ? 0 : 0.4;
 */
export { useReducedMotion } from "framer-motion";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Base props for all motion components.
 */
interface BaseMotionProps {
  children: ReactNode;
  /** Disable animations programmatically (useful for testing or SSR) */
  disabled?: boolean;
  /** Override the default animation variants */
  variants?: Variants;
  /** Additional class names */
  className?: string;
}

/**
 * Props for motion div components.
 */
type MotionDivProps = BaseMotionProps &
  Omit<HTMLMotionProps<"div">, "variants" | "children">;

/**
 * Props for FadeInUp with delay support.
 */
interface FadeInUpProps extends MotionDivProps {
  /** Delay before animation starts (in seconds) */
  delay?: number;
}

/**
 * Props for StaggerContainer with custom stagger timing.
 */
interface StaggerContainerProps extends MotionDivProps {
  /** Time between each child animation (in seconds) */
  staggerDelay?: number;
  /** Initial delay before first child animates (in seconds) */
  delayChildren?: number;
}

// =============================================================================
// COMPONENTS
// =============================================================================

/**
 * FadeInUp - Entrance animation with upward motion.
 *
 * Animates when the element scrolls into view; still under reduced motion
 * (see the module header).
 *
 * @example
 * <FadeInUp>
 *   <h2>Section Title</h2>
 * </FadeInUp>
 *
 * @example
 * // With delay
 * <FadeInUp delay={0.2}>
 *   <p>Delayed content</p>
 * </FadeInUp>
 */
export const FadeInUp = forwardRef<HTMLDivElement, FadeInUpProps>(
  (
    {
      children,
      disabled,
      variants = fadeInUp,
      delay = 0,
      className,
      ...props
    },
    ref
  ) => {
    // Static when disabled; reduced motion is the stylesheet's (see above)
    if (disabled) {
      return (
        <div ref={ref} className={className} {...filterMotionProps(props)}>
          {children}
        </div>
      );
    }

    return (
      <motion.div
        ref={ref}
        data-reveal=""
        initial="hidden"
        whileInView="visible"
        viewport={viewportSettings.standard}
        variants={variants}
        transition={{ ...transitions.smooth, delay }}
        className={className}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);
FadeInUp.displayName = "FadeInUp";

/**
 * FadeIn - Simple opacity fade without translation.
 *
 * Use for subtle reveals where movement would be distracting.
 *
 * @example
 * <FadeIn>
 *   <img src="/hero.png" alt="Hero" />
 * </FadeIn>
 */
export const FadeIn = forwardRef<HTMLDivElement, FadeInUpProps>(
  (
    {
      children,
      disabled,
      variants = fadeIn,
      delay = 0,
      className,
      ...props
    },
    ref
  ) => {
    if (disabled) {
      return (
        <div ref={ref} className={className} {...filterMotionProps(props)}>
          {children}
        </div>
      );
    }

    return (
      <motion.div
        ref={ref}
        data-reveal=""
        initial="hidden"
        whileInView="visible"
        viewport={viewportSettings.standard}
        variants={variants}
        transition={{ ...transitions.smooth, delay }}
        className={className}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);
FadeIn.displayName = "FadeIn";

/**
 * ScaleIn - Entrance animation with subtle scale.
 *
 * Use for elements that should feel like they're "popping" into view.
 *
 * @example
 * <ScaleIn>
 *   <Card variant="feature">Featured Item</Card>
 * </ScaleIn>
 */
export const ScaleIn = forwardRef<HTMLDivElement, FadeInUpProps>(
  (
    {
      children,
      disabled,
      variants = scaleIn,
      delay = 0,
      className,
      ...props
    },
    ref
  ) => {
    if (disabled) {
      return (
        <div ref={ref} className={className} {...filterMotionProps(props)}>
          {children}
        </div>
      );
    }

    return (
      <motion.div
        ref={ref}
        data-reveal=""
        initial="hidden"
        whileInView="visible"
        viewport={viewportSettings.standard}
        variants={variants}
        transition={{ ...transitions.spring, delay }}
        className={className}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);
ScaleIn.displayName = "ScaleIn";

/**
 * StaggerContainer - Parent for staggered child animations.
 *
 * Wrap a group of elements to animate them sequentially.
 * Children should use StaggerItem for proper coordination.
 *
 * @example
 * <StaggerContainer className="grid grid-cols-3 gap-4">
 *   {features.map(feature => (
 *     <StaggerItem key={feature.id}>
 *       <FeatureCard {...feature} />
 *     </StaggerItem>
 *   ))}
 * </StaggerContainer>
 */
export const StaggerContainer = forwardRef<HTMLDivElement, StaggerContainerProps>(
  (
    {
      children,
      disabled,
      variants,
      staggerDelay = 0.1,
      delayChildren = 0.1,
      className,
      ...props
    },
    ref
  ) => {
    if (disabled) {
      return (
        <div ref={ref} className={className} {...filterMotionProps(props)}>
          {children}
        </div>
      );
    }

    // Use custom variants if provided, otherwise create from props
    const containerVariants: Variants = variants ?? {
      hidden: {},
      visible: {
        transition: {
          staggerChildren: staggerDelay,
          delayChildren: delayChildren,
        },
      },
    };

    return (
      <motion.div
        ref={ref}
        data-reveal=""
        initial="hidden"
        whileInView="visible"
        viewport={viewportSettings.standard}
        variants={containerVariants}
        className={className}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);
StaggerContainer.displayName = "StaggerContainer";

/**
 * StaggerItem - Child element within a StaggerContainer.
 *
 * Automatically inherits animation state from parent StaggerContainer.
 * Must be a direct or nested child of StaggerContainer.
 *
 * @example
 * <StaggerContainer>
 *   <StaggerItem>First</StaggerItem>
 *   <StaggerItem>Second</StaggerItem>
 *   <StaggerItem>Third</StaggerItem>
 * </StaggerContainer>
 */
export const StaggerItem = forwardRef<HTMLDivElement, MotionDivProps>(
  ({ children, disabled, variants = fadeInUp, className, ...props }, ref) => {
    if (disabled) {
      return (
        <div ref={ref} className={className} {...filterMotionProps(props)}>
          {children}
        </div>
      );
    }

    return (
      <motion.div
        ref={ref}
        data-reveal=""
        variants={variants}
        transition={transitions.smooth}
        className={className}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);
StaggerItem.displayName = "StaggerItem";

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Filter out motion-specific props when rendering a static div.
 * This prevents React warnings about unknown DOM attributes.
 */
function filterMotionProps(
  props: Record<string, unknown>
): ComponentPropsWithoutRef<"div"> {
  const motionPropKeys = [
    "initial",
    "animate",
    "exit",
    "variants",
    "transition",
    "whileHover",
    "whileTap",
    "whileFocus",
    "whileDrag",
    "whileInView",
    "viewport",
    "onAnimationStart",
    "onAnimationComplete",
    "onUpdate",
    "onDragStart",
    "onDrag",
    "onDragEnd",
    "dragConstraints",
    "dragElastic",
    "dragMomentum",
    "dragTransition",
    "drag",
    "dragControls",
    "dragListener",
    "dragPropagation",
    "dragDirectionLock",
    "onDirectionLock",
    "onDragTransitionEnd",
    "layout",
    "layoutId",
    "onLayoutAnimationStart",
    "onLayoutAnimationComplete",
    "layoutDependency",
    "layoutScroll",
    "layoutRoot",
    "transformTemplate",
    "custom",
    "inherit",
    "onBeforeLayoutMeasure",
    "onViewportEnter",
    "onViewportLeave",
  ];

  const filtered: Record<string, unknown> = {};
  for (const key in props) {
    if (!motionPropKeys.includes(key)) {
      filtered[key] = props[key];
    }
  }
  return filtered as ComponentPropsWithoutRef<"div">;
}
