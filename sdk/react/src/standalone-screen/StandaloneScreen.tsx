"use client";

// The frame for every screen a console draws outside its own frame: signing
// in, the gates between signing in and the app, a configuration that didn't
// load, a console that stopped working, the desktop app's server screens.
// One column, the host's mark on top, a title, one line under it, the
// screen's body, one row of acts and the server's help line, so each of
// those screens reads as the same product in both consoles. It renders
// before any `StigmerProvider` (the help line then draws nothing), so a
// screen that failed before its client existed can still stand on it.

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { HelpLink } from "../help/HelpLink.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link StandaloneScreen}. */
export interface StandaloneScreenProps {
  /**
   * The host's mark, centred at the top (the kit draws no logo of its own).
   * A 40px mark sits best.
   */
  readonly mark?: ReactNode;
  /** The screen's heading, its `h1` (20/28 semibold). */
  readonly title?: ReactNode;
  /** One line under the title, in the muted 14/20. */
  readonly lead?: ReactNode;
  /**
   * What the screen is waiting for ("Checking your account…"), drawn as a
   * spinner over the line, as a live status. Use it instead of a body while
   * the screen waits.
   */
  readonly wait?: ReactNode;
  /**
   * The acts: one primary `Button` (or `LinkButton`) and at most one quiet
   * ghost one under it, each the column's width.
   */
  readonly acts?: ReactNode;
  /** Draws the server's help line under the acts ("Stuck? …"), when the server announces one. */
  readonly help?: boolean;
  /** The top-right corner: who is signed in, and Sign out (the console's `UserMenu`). */
  readonly corner?: ReactNode;
  /** The screen's body: a form, a failure (`ErrorMessage`), a note. */
  readonly children?: ReactNode;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * A screen outside the console's frame: the mark, a title, a line, the body,
 * one act and the help line, in one 384px column.
 *
 * @example
 * ```tsx
 * <StandaloneScreen
 *   mark={<img src="/logo.svg" alt="" width={40} height={40} />}
 *   title="Sign in to Stigmer"
 *   lead="You'll continue on your sign-in page, then come straight back here."
 *   acts={<a href="/login">Sign in</a>}
 *   help
 * />
 * ```
 */
export function StandaloneScreen({ mark, title, lead, wait, acts, help, corner, children, className }: StandaloneScreenProps) {
  return (
    <div
      className={cn(
        "stg:relative stg:flex stg:min-h-screen stg:items-center stg:justify-center stg:bg-background stg:px-4 stg:py-16 stg:text-foreground",
        className,
      )}
    >
      {corner !== undefined && <div className="stg:absolute stg:top-3 stg:right-3">{corner}</div>}
      <div className="stg:flex stg:w-full stg:max-w-sm stg:flex-col stg:gap-6">
        <div className="stg:flex stg:flex-col stg:items-center stg:gap-4 stg:text-center">
          {mark !== undefined && <div className="stg:flex stg:shrink-0">{mark}</div>}
          {title !== undefined && <h1 className="stg:m-0 stg:text-xl stg:font-semibold">{title}</h1>}
          {lead !== undefined && <p className="stg:m-0 stg:-mt-2 stg:text-sm stg:text-muted-foreground">{lead}</p>}
        </div>
        {wait !== undefined && <ScreenWait>{wait}</ScreenWait>}
        {children}
        {acts !== undefined && <div className="stg:flex stg:flex-col stg:gap-2 stg:[&>*]:w-full">{acts}</div>}
        {help === true && <HelpLink className="stg:text-center" />}
      </div>
    </div>
  );
}

/**
 * A wait inside a screen: the spinner, and the line under it when there is one.
 *
 * @internal Not part of the public API.
 */
export function ScreenWait({ children }: { readonly children?: ReactNode }) {
  return (
    <div role="status" className="stg:flex stg:flex-col stg:items-center stg:gap-3 stg:text-center stg:text-sm stg:text-muted-foreground">
      <SpinnerIcon size={20} />
      {children !== undefined && <span>{children}</span>}
    </div>
  );
}
