"use client";

// A browser page that sends the person back to an app on their computer:
// the desktop app's billing return and its sign-in return. The page says
// what happened and keeps one way back in case the computer didn't switch,
// since an operating system that doesn't open the app leaves the person on a
// page that otherwise waits for ever. The host does the redirect; this view
// only draws it.

import type { ReactNode } from "react";
import { LinkButton } from "../button/LinkButton.js";
import { StandaloneScreen } from "../standalone-screen/StandaloneScreen.js";

/** Props for {@link AppHandoffView}. */
export interface AppHandoffViewProps {
  /** What happened, as the title ("Your card is saved"). Omit it to draw only the wait. */
  readonly title?: ReactNode;
  /** The line under the title ("Go back to Stigmer Desktop to carry on. You can close this tab."). */
  readonly lead?: ReactNode;
  /** The wait while the browser hands back ("Going back to Stigmer Desktop…"), drawn when there is no title. */
  readonly wait?: ReactNode;
  /** The app's own address (its deep link), offered as the one act. */
  readonly href?: string;
  /** The act's words. */
  readonly actLabel?: string;
  /** The host's mark, on top. */
  readonly mark?: ReactNode;
}

/**
 * The page that hands the browser back to an app, with the way back kept.
 *
 * @example
 * ```tsx
 * <AppHandoffView
 *   title="Your card is saved"
 *   lead="Go back to Stigmer Desktop to carry on. You can close this tab."
 *   href="stigmer://billing"
 *   actLabel="Open Stigmer Desktop"
 * />
 * ```
 */
export function AppHandoffView({ title, lead, wait, href, actLabel = "Open the app", mark }: AppHandoffViewProps) {
  if (title === undefined) return <StandaloneScreen mark={mark} wait={wait} />;
  return (
    <StandaloneScreen
      mark={mark}
      title={title}
      lead={lead}
      acts={href !== undefined ? <LinkButton href={href}>{actLabel}</LinkButton> : undefined}
    />
  );
}
