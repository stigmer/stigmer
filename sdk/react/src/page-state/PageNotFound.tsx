"use client";

// The console's page for an address that leads nowhere: inside the
// console's frame, in the words of the agent page's "isn't here", with one
// way on. The web console's `not-found` route and the desktop app's unknown
// address draw it; the host says where the dashboard is and how its links
// navigate.

import { Search } from "lucide-react";
import { EmptyState } from "../empty-state/EmptyState.js";
import { LinkButton, type RenderLink } from "../button/LinkButton.js";
import { PageFrame } from "../page-frame/PageFrame.js";

/** Props for {@link PageNotFound}. */
export interface PageNotFoundProps {
  /** Where "Go to the dashboard" leads (the web console's `/`, the desktop app's `/dashboard`). */
  readonly homeHref: string;
  /** Draws the link with the host's router; a plain anchor when omitted. */
  readonly renderLink?: RenderLink;
}

/**
 * The page for an address that leads nowhere, with the way to the dashboard.
 *
 * @example
 * ```tsx
 * // renderLink is where the host's router link goes; a plain anchor works too.
 * <PageNotFound homeHref="/" renderLink={({ href, children, ...rest }) => <a href={href} {...rest}>{children}</a>} />
 * ```
 */
export function PageNotFound({ homeHref, renderLink }: PageNotFoundProps) {
  return (
    <PageFrame>
      <EmptyState
        variant="first-use"
        icon={<Search />}
        title="There's nothing at this address"
        description="It may have been mistyped, or the page has moved."
      >
        <LinkButton href={homeHref} variant="outline" renderLink={renderLink}>
          Go to the dashboard
        </LinkButton>
      </EmptyState>
    </PageFrame>
  );
}
