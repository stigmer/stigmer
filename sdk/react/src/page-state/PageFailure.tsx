"use client";

// The console's page for a page that broke while drawing: the failure's
// title from the error's kind, the server's line, Try again, the way home,
// and the reference a framework gives the failure. The web console's error
// boundaries draw it, the root one as a page and settings' inside its own
// frame; the host says where home is and how its links navigate.

import { AlertTriangle, RotateCcw, ShieldX } from "lucide-react";
import { classifyError, getUserMessage, type ErrorCategory } from "@stigmer/client";
import { Button } from "../button/Button.js";
import { LinkButton, type RenderLink } from "../button/LinkButton.js";
import { HelpLink } from "../help/HelpLink.js";
import { StatePanel } from "./StatePanel.js";

/** Where a {@link PageFailure} sends the person instead of trying again. */
export interface PageFailureLink {
  /** The link's words ("Go to Dashboard"). */
  readonly label: string;
  /** Where it leads. */
  readonly href: string;
}

/** Props for {@link PageFailure}. */
export interface PageFailureProps {
  /** What broke. A `digest` (Next.js's reference for a server failure) is shown under the acts. */
  readonly error: Error & { readonly digest?: string };
  /** Draws the page again. */
  readonly onRetry: () => void;
  /** The way out beside Try again. */
  readonly link: PageFailureLink;
  /** Draws the link with the host's router; a plain anchor when omitted. */
  readonly renderLink?: RenderLink;
  /**
   * `page` (the default) is a whole page's failure: the page's heading, and
   * the server's help line under the acts. `section` sits inside a frame
   * that already titles the page (settings), under an `h2`, without the help line.
   */
  readonly placement?: "page" | "section";
  /** Titles for the error's kinds, over the defaults; a kind with no title reads "Something went wrong". */
  readonly titles?: Partial<Record<ErrorCategory, string>>;
}

const DEFAULT_TITLES: Partial<Record<ErrorCategory, string>> = {
  auth: "Authentication required",
  permission: "Access denied",
  "not-found": "Page not found",
  server: "Server error",
  unavailable: "Service unavailable",
};

/**
 * The page for a page that broke: what happened, Try again, and the way out.
 *
 * @example
 * ```tsx
 * <PageFailure error={error} onRetry={reset} link={{ label: "Go to Dashboard", href: "/" }} />
 * ```
 */
export function PageFailure({ error, onRetry, link, renderLink, placement = "page", titles }: PageFailureProps) {
  const category = classifyError(error);
  const title = { ...DEFAULT_TITLES, ...titles }[category] ?? "Something went wrong";
  const Icon = category === "auth" || category === "permission" ? ShieldX : AlertTriangle;
  const isPage = placement === "page";
  return (
    <StatePanel
      placement={isPage ? "page" : "section"}
      tone="failed"
      icon={<Icon className="stg:size-6" />}
      title={title}
      headingLevel={isPage ? 1 : 2}
      description={getUserMessage(error)}
      acts={
        <>
          <Button variant="outline" onClick={onRetry} icon={<RotateCcw className="stg:size-3.5" />}>
            Try again
          </Button>
          <LinkButton href={link.href} variant="ghost" renderLink={renderLink}>
            {link.label}
          </LinkButton>
        </>
      }
      after={
        <>
          {isPage && <HelpLink />}
          {error.digest && (
            <p className="stg:m-0 stg:font-mono stg:text-xs stg:text-muted-foreground-subtle">Reference: {error.digest}</p>
          )}
        </>
      }
    />
  );
}
