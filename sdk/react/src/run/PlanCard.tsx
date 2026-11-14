"use client";

// A Plan-mode turn's plan, shown once in the thread as one card: a 32px
// muted square with a list glyph, the plan's title (14/20 semibold) over a
// subline (12/16 muted), and the acts at the right. Each state says its own
// words and offers only its own acts, so no caller can put Build on a plan
// that is not the one to build:
//
// - writing: "Writing the plan…" (pulsing, still where motion is reduced);
//   Open, as a labelled ghost button.
// - ready: "Plan · 4.1 KB" (the size as the turn's Made cards say it);
//   Open, Copy and Download as icons, then Build, the primary.
// - replaced: "Replaced by a newer plan"; Open and Copy, never Build.
// - text: a completed plan held only as message text; its text under the
//   header, and Build.
//
// The card draws; it does not act. Each public plan component
// (`PlanFileCard`, `PlanStreamingCard`, `PlanCompletionCard`,
// `PlanDocumentMessage`) hands in what its acts call, its copied tick and
// its busy states. `PlanCardHeader` and `planSubline` are the same header
// and words alone, for the panel's plan document (`PlanStreamingDocument`,
// `PlanEditor`).
// Internal: not exported from the package.

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { Card } from "../internal/surface/Card.js";
import { Button } from "../button/Button.js";
import { IconButton } from "../button/IconButton.js";
import { sizeWords } from "../internal/size-words.js";

/** Which plan the card shows: being written, ready to build, replaced by a newer one, or held only as text. */
export type PlanCardState = "writing" | "ready" | "replaced" | "text";

/** One act the card offers: its accessible name (and tooltip, as an icon) and what it calls. */
export interface PlanCardAct {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

/** Props for {@link PlanCard}. */
export interface PlanCardProps extends Omit<HTMLAttributes<HTMLDivElement>, "title" | "children"> {
  readonly state: PlanCardState;
  readonly title: string;
  /** The plan File's size, said in a ready plan's subline; unknown or zero says only "Plan". */
  readonly sizeBytes?: bigint;
  /** The plan's text, drawn under the header (the `text` state). */
  readonly body?: ReactNode;
  /** Opens the plan: a labelled "Open" while writing, an eye icon otherwise. */
  readonly open?: PlanCardAct;
  /** Copies the plan's text; `copied` draws the tick. Offered when ready or replaced. */
  readonly copy?: PlanCardAct & { readonly copied?: boolean };
  /** Downloads the plan File. Offered when ready. */
  readonly download?: PlanCardAct;
  /** Builds from the plan, the primary; `pending` reads "Starting build…". Offered when ready or text. */
  readonly build?: { readonly onClick: () => void; readonly disabled?: boolean; readonly pending?: boolean };
  /** Drawn after the card's content: a live region, a preview dialog. */
  readonly children?: ReactNode;
}

/** The plan card (module header). */
export function PlanCard({ state, title, sizeBytes, body, open, copy, download, build, children, className, ...rest }: PlanCardProps) {
  const offersIcons = state === "ready" || state === "replaced";
  const offersBuild = state === "ready" || state === "text";
  const acts = (
    <>
      {state === "writing" && open !== undefined && (
        <Button variant="ghost" size="xs" aria-label={open.label} onClick={open.onClick} disabled={open.disabled} icon={<EyeGlyph />}>
          Open
        </Button>
      )}
      {offersIcons && open !== undefined && <IconButton size="xs" label={open.label} icon={<EyeGlyph />} onClick={open.onClick} disabled={open.disabled} />}
      {offersIcons && copy !== undefined && (
        <IconButton size="xs" label={copy.label} icon={copy.copied ? <CheckGlyph /> : <CopyGlyph />} onClick={copy.onClick} disabled={copy.disabled} />
      )}
      {state === "ready" && download !== undefined && (
        <IconButton size="xs" label={download.label} icon={<DownloadGlyph />} onClick={download.onClick} disabled={download.disabled} />
      )}
      {offersBuild && build !== undefined && (
        <Button size="xs" disabled={build.disabled} onClick={build.onClick} icon={<BuildGlyph />} className="stg:ml-1">
          {build.pending ? "Starting build…" : "Build"}
        </Button>
      )}
    </>
  );
  const subline = planSubline(state, sizeBytes);
  const hasActs = (state === "writing" && open !== undefined) || (offersIcons && (open ?? copy ?? download) !== undefined) || (offersBuild && build !== undefined);
  return (
    <Card flush className={className} {...rest}>
      <PlanCardHeader
        // A card that holds the plan's text is a document, and its header opens it.
        as={body === undefined ? "div" : "header"}
        title={title}
        subline={subline}
        acts={hasActs ? acts : undefined}
        className="stg:px-4 stg:py-3"
      />
      {body !== undefined && <div className="stg:border-t stg:border-border-muted stg:px-4 stg:py-4">{body}</div>}
      {children}
    </Card>
  );
}

/**
 * A state's subline, in the card's words: "Writing the plan…" (a pulsing
 * live status), "Plan · 4.1 KB", "Replaced by a newer plan", or nothing for
 * a plan held only as text. The panel's plan document says the same.
 */
export function planSubline(state: PlanCardState, sizeBytes?: bigint): ReactNode {
  if (state === "writing") {
    return (
      <span role="status" className="stgm-shimmer-label">
        Writing the plan…
      </span>
    );
  }
  if (state === "replaced") return "Replaced by a newer plan";
  if (state === "text") return undefined;
  const size = sizeWords(sizeBytes);
  return size === "" ? "Plan" : `Plan · ${size}`;
}

/** Props for {@link PlanCardHeader}. */
export interface PlanCardHeaderProps {
  readonly title: string;
  /** The line under the title; nothing when omitted. */
  readonly subline?: ReactNode;
  /** The acts at the right. */
  readonly acts?: ReactNode;
  /** A `header` where the header opens a document (an article), else a `div`. @default "div" */
  readonly as?: "div" | "header";
  readonly className?: string;
}

/** The plan card's header alone: the glyph's square, the title over its subline, the acts at the right. */
export function PlanCardHeader({ title, subline, acts, as: Element = "div", className }: PlanCardHeaderProps) {
  return (
    <Element className={cn("stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:gap-x-3 stg:gap-y-2", className)}>
      <span
        aria-hidden="true"
        data-plan-glyph=""
        className="stg:flex stg:h-8 stg:w-8 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-md stg:bg-muted stg:text-muted-foreground"
      >
        <ListGlyph />
      </span>
      <div className="stg:min-w-0 stg:flex-1 stg:basis-48">
        <div className="stg:truncate stg:text-sm stg:font-semibold stg:text-foreground">{title}</div>
        {subline !== undefined && <div className="stg:truncate stg:text-xs stg:text-muted-foreground">{subline}</div>}
      </div>
      {acts !== undefined && <div className="stg:ml-auto stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:gap-1">{acts}</div>}
    </Element>
  );
}

/** The plan's mark: a list. */
function ListGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </svg>
  );
}

/** Open: an eye, "read the plan". */
function EyeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CopyGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** The copied tick, in the ready colour the theme contract measures as text. */
function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:text-status-ready"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

/** Build: an arrow, "go". */
function BuildGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
