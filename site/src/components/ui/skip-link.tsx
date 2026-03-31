/**
 * Skip Link Component
 *
 * Accessibility feature that allows keyboard users to bypass navigation
 * and jump directly to the main content. The link is visually hidden
 * until focused, appearing at the top-left of the viewport.
 *
 * WCAG 2.1 Success Criterion 2.4.1 (Bypass Blocks):
 * "A mechanism is available to bypass blocks of content that are
 * repeated on multiple Web pages."
 *
 * @example
 * // In your layout or page component
 * <SkipLink />
 * <Header />
 * <main id="main-content">...</main>
 */

import { cn } from "@/lib/utils";

export interface SkipLinkProps {
  /**
   * The target element ID to skip to (without the # prefix).
   * @default "main-content"
   */
  targetId?: string;
  /**
   * The visible text when the link is focused.
   * @default "Skip to main content"
   */
  label?: string;
  /**
   * Additional CSS classes.
   */
  className?: string;
}

/**
 * Skip link for keyboard navigation accessibility.
 *
 * Allows users to bypass navigation and jump directly to main content.
 * Visually hidden until focused via Tab key.
 *
 * @example
 * <SkipLink />
 * // Or with custom target
 * <SkipLink targetId="content" label="Skip to content" />
 */
function SkipLink({
  targetId = "main-content",
  label = "Skip to main content",
  className,
}: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className={cn(
        // Visually hidden by default using sr-only pattern
        "sr-only",
        // Becomes visible and styled when focused
        "focus:not-sr-only",
        "focus:fixed focus:top-4 focus:left-4 focus:z-[100]",
        "focus:px-4 focus:py-2 focus:rounded-md",
        "focus:bg-primary focus:text-primary-foreground",
        "focus:font-medium focus:text-sm",
        // Focus ring for visual feedback
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
        // Smooth transition when becoming visible
        "focus:shadow-lg",
        className
      )}
    >
      {label}
    </a>
  );
}

export { SkipLink };
