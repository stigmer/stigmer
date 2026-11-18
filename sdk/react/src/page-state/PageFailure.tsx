"use client";

// The console's page for a page that broke while drawing: inside the
// console's frame, the kit's failure note says it from the error's kind
// (signed out, no access, the server didn't answer), what wasn't lost, one
// act, and the failure's reference in Copy details rather than read aloud.
// A quiet way out sits under it when the host gives one. The web console's
// error boundaries draw it, the root one as a page and settings' inside its
// own frame; the desktop app's render failure the same.

import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { LinkButton, type RenderLink } from "../button/LinkButton.js";
import { PageFrame } from "../page-frame/PageFrame.js";

/** Where a {@link PageFailure} offers to go instead of trying again. */
export interface PageFailureLink {
  /** The link's words ("Back to Settings"). */
  readonly label: string;
  /** Where it leads. */
  readonly href: string;
}

/** Props for {@link PageFailure}. */
export interface PageFailureProps {
  /** What broke. A `digest` (Next.js's reference for a server failure) goes into Copy details. */
  readonly error: Error & { readonly digest?: string };
  /** Draws the page again; offered where trying again can help. */
  readonly onRetry: () => void;
  /** Signs the person in again; offered when the failure is that they're signed out. */
  readonly signIn?: () => void;
  /** What wasn't lost. Defaults to "Nothing was lost; only this page didn't load." */
  readonly comfort?: ReactNode;
  /** A quiet way out under the note. */
  readonly link?: PageFailureLink;
  /** Draws the link with the host's router; a plain anchor when omitted. */
  readonly renderLink?: RenderLink;
  /**
   * `page` (the default) draws in the console's page frame; `section` sits
   * inside a frame its layout already draws (settings).
   */
  readonly placement?: "page" | "section";
}

/**
 * The page for a page that broke: what happened, one act, and a way out.
 *
 * @example
 * ```tsx
 * // A Next.js `error.tsx`: the framework passes the error and `reset`.
 * function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
 *   return <PageFailure error={error} onRetry={reset} />;
 * }
 * ```
 */
export function PageFailure({ error, onRetry, signIn, comfort, link, renderLink, placement = "page" }: PageFailureProps) {
  const body = (
    <div className="stg:flex stg:flex-col stg:items-start stg:gap-3">
      <ErrorMessage
        error={error}
        comfort={comfort ?? "Nothing was lost; only this page didn't load."}
        retry={onRetry}
        signIn={signIn}
        reference={error.digest}
        className="stg:w-full"
      />
      {link !== undefined && (
        <LinkButton href={link.href} variant="ghost" icon={<ArrowLeft className="stg:size-4" />} renderLink={renderLink}>
          {link.label}
        </LinkButton>
      )}
    </div>
  );
  return placement === "page" ? <PageFrame>{body}</PageFrame> : body;
}
