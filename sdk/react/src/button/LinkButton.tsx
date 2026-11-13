"use client";

// A link drawn as a button: a page's act that goes somewhere (Create agent,
// Open Models & providers). It stays a link to the browser and to assistive
// technology, and a host with its own router passes its link component,
// as the kit's other links take one.

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./buttonClasses.js";

/** Draws a link; a host with its own router passes its link component (Next's `Link`, react-router's). */
export type RenderLink = (props: { readonly href: string; readonly className: string; readonly children: ReactNode }) => ReactNode;

/** A plain anchor, for a host that passes no link component. */
export const anchorLink: RenderLink = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

/** Props for {@link LinkButton}. */
export interface LinkButtonProps {
  /** Where the link goes. */
  readonly href: string;
  /** The link's words. */
  readonly children: ReactNode;
  /** Visual weight. @default "primary" */
  readonly variant?: ButtonVariant;
  /** Size. @default "sm" */
  readonly size?: ButtonSize;
  /** Optional leading icon, rendered before the words. */
  readonly icon?: ReactNode;
  /** Draws the link; a plain `<a>` when omitted. */
  readonly renderLink?: RenderLink;
  /** Additional classes, after the button's. */
  readonly className?: string;
}

/**
 * A link that looks like a {@link Button} and stays a link.
 *
 * Every variant and size of `Button`, drawn on a link the host renders, so
 * a page's act that goes somewhere is still opened in a new tab, copied and
 * announced as a link.
 *
 * This is an SDK component — embeddable by platform builders.
 *
 * @example
 * ```tsx
 * import { LinkButton, type RenderLink } from "@stigmer/react-sdk";
 *
 * // A host with its own router passes its link component here (Next's `Link`, react-router's).
 * const renderLink: RenderLink = ({ href, className, children }) => (
 *   <a href={href} className={className}>
 *     {children}
 *   </a>
 * );
 *
 * <LinkButton href="/library/agents/new" renderLink={renderLink}>
 *   Create agent
 * </LinkButton>
 * ```
 */
export function LinkButton({ href, children, variant = "primary", size = "sm", icon, renderLink = anchorLink, className }: LinkButtonProps) {
  return (
    <>
      {renderLink({
        href,
        className: cn(buttonClasses(variant, size), className),
        children: (
          <>
            {icon}
            {children}
          </>
        ),
      })}
    </>
  );
}
