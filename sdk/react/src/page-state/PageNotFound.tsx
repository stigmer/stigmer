"use client";

// The console's page for an address that leads nowhere: it says the page
// isn't there and offers the way home. The web console's `not-found` route
// draws it; the host says where home is and how its links navigate.

import { FileQuestion } from "lucide-react";
import { LinkButton, type RenderLink } from "../button/LinkButton.js";
import { StatePanel } from "./StatePanel.js";

/** Props for {@link PageNotFound}. */
export interface PageNotFoundProps {
  /** Where "Go to Dashboard" leads (the web console's `/`, the desktop app's `/dashboard`). */
  readonly homeHref: string;
  /** Draws the link with the host's router; a plain anchor when omitted. */
  readonly renderLink?: RenderLink;
}

/**
 * The page for an address that leads nowhere, with the way home.
 *
 * @example
 * ```tsx
 * // renderLink is where the host's router link goes; a plain anchor works too.
 * <PageNotFound homeHref="/" renderLink={({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a>} />
 * ```
 */
export function PageNotFound({ homeHref, renderLink }: PageNotFoundProps) {
  return (
    <StatePanel
      placement="page"
      tone="quiet"
      icon={<FileQuestion className="stg:size-6" />}
      title="Page not found"
      headingLevel={1}
      description="The page you're looking for doesn't exist or has been moved."
      acts={
        <LinkButton href={homeHref} renderLink={renderLink}>
          Go to Dashboard
        </LinkButton>
      }
    />
  );
}
