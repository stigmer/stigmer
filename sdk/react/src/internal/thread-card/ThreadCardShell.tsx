"use client";

import type { ReactNode, Ref } from "react";
import { cn } from "@stigmer/design-tokens";
import { Tooltip, TooltipContent, TooltipTrigger } from "../tooltip.js";
import { ChevronIcon } from "./glyphs.js";

/**
 * The shared card shell for thread rows — session tool-call cards compose
 * the chrome, header gestures, and body contract from it, so every row
 * reads as one visual language by construction. Extracted from
 * `ToolCallItem`, whose DOM is the canonical anatomy.
 *
 * Three pieces, composed via children (slots-as-children, never a
 * mega-prop card — each thread's composition stays explicit):
 *
 * - {@link ThreadCardShell} — the chrome tier: bordered card, nested divider
 *   row, or quiet unboxed line ({@link ThreadCardVariant}), plus the
 *   pending-gate accent.
 * - {@link ThreadCardHeader} — the one-line header region with a
 *   primary gesture: `expand` (summary rows: a toggle button with
 *   `aria-expanded`, plus the chevron) or `none` (preview rows — their body
 *   is always visible, so the header has no job beyond layout).
 * - {@link ThreadCardHeaderControl} — the wrapper that keeps a control of
 *   the header's own (a file link, a Stop button) reachable above the toggle.
 * - {@link ThreadCardBody} — the disclosed content area's padding
 *   contract.
 *
 * The shell owns layout + chrome + a11y, nothing more: no data fetching,
 * no presenters, no disclosure policy (those stay per-thread). It renders
 * beneath the threads' memoized row components and takes only primitives
 * and stable callbacks, so it never disturbs their memo bails.
 *
 * An interactive header holds no control inside its toggle. The toggle is a
 * real, empty `<button>` laid over the whole header (any click on the row
 * opens it, one tab stop, Enter and Space from the platform), named by the
 * caller's `label`; the header's text sits beside it, painted under it. A
 * control the header carries (a file link, a Stop button) is the toggle's
 * sibling, lifted above it by {@link ThreadCardHeaderControl}, so a screen
 * reader reaches it as itself and its click never reaches the toggle. Nesting a control inside a
 * `role=button` would hide it from assistive technology (axe's
 * `nested-interactive`), which is why the toggle never wraps the content.
 * The cost is that header text cannot be selected with the pointer; the
 * disclosed body carries every value in selectable form.
 *
 * @internal Not part of the public API.
 */

// ---------------------------------------------------------------------------
// Shell — the card chrome
// ---------------------------------------------------------------------------

/**
 * The chrome tier of a thread row (the density axis at the shell level):
 *
 * - `"card"` — a self-contained bordered card (the default).
 * - `"row"` — a divider-separated row for rows nested inside a container
 *   that already provides the frame (e.g. an expanded `ToolRunGroup` fold),
 *   avoiding a card-in-a-card.
 * - `"quiet"` — no chrome at all: an unboxed line for metadata-only rows
 *   whose header IS the complete information (reads, listings, thoughts).
 *   The gate accent is deliberately not drawn in this tier — a row carrying
 *   an accent must be escalated to `"card"` by the caller, never rendered
 *   as an accented bare line.
 */
export type ThreadCardVariant = "card" | "row" | "quiet";

/** Props for {@link ThreadCardShell}. */
export interface ThreadCardShellProps {
  /** The chrome tier — see {@link ThreadCardVariant}. Defaults to `"card"`. */
  readonly variant?: ThreadCardVariant;
  /**
   * A restrained left accent for a row awaiting a human decision —
   * `"warning"` for ordinary gates, `"destructive"` for delete gates.
   */
  readonly accent?: "warning" | "destructive" | null;
  /** Rendered as `data-cursor-target` on the root for e2e targeting. */
  readonly cursorTarget?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /** Ref to the root element (e.g. for scroll-into-view on selection). */
  readonly ref?: Ref<HTMLDivElement>;
  readonly children: ReactNode;
}

const VARIANT_CHROME: Record<Exclude<ThreadCardVariant, "card">, string> = {
  row: "stg:border-b stg:border-border-muted stg:last:border-b-0",
  quiet: "",
};

/** The thread card's outer chrome. See the module doc for the full contract. */
export function ThreadCardShell({
  variant = "card",
  accent = null,
  cursorTarget,
  className,
  ref,
  children,
}: ThreadCardShellProps) {
  // The pending gate's accent rides a card and a divider row alike: a step
  // waiting for a person inside a list of steps keeps its "needs you" cue.
  const accentChrome = cn(
    accent === "warning" && "stg:border-l-2 stg:border-l-warning",
    accent === "destructive" && "stg:border-l-2 stg:border-l-destructive",
  );
  const chrome =
    variant === "card"
      ? cn(
          // border-prominent (not border): a transparent card needs a line the
          // eye actually catches — the default border token is white at 14%
          // opacity, which vanishes on the dark thread surface.
          "stg:rounded-lg stg:border stg:border-border-prominent stg:overflow-hidden",
          accentChrome,
        )
      : variant === "row"
        ? cn(VARIANT_CHROME.row, accentChrome)
        : VARIANT_CHROME.quiet;

  return (
    <div ref={ref} data-cursor-target={cursorTarget} className={cn(chrome, className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header — one layout, per-surface primary gesture
// ---------------------------------------------------------------------------

/**
 * The header's primary gesture. `expand` toggles a chevron-gated body
 * through a toggle button laid over the header (`aria-expanded`; the chevron
 * is appended automatically). `none` renders a non-interactive layout row
 * (preview cards — their body is always visible).
 */
export type ThreadCardHeaderGesture =
  | { readonly kind: "none" }
  | {
      readonly kind: "expand";
      readonly expanded: boolean;
      readonly onToggle: () => void;
      /**
       * The toggle's accessible name: what the row is, in its own words
       * ("Read july-statement.csv", "Searched invoices, 12 matches"). Required
       * because the toggle is empty; the header's text is its sibling.
       */
      readonly label: string;
      /**
       * Text the toggle shows on hover and keyboard focus: the full value of a
       * subtitle the header cuts off. Omit it while nothing is cut off, so an
       * uncut row shows no tooltip.
       */
      readonly hint?: string;
    };

/** Props for {@link ThreadCardHeader}. */
export interface ThreadCardHeaderProps {
  /** The primary gesture. Defaults to `{ kind: "none" }`. */
  readonly gesture?: ThreadCardHeaderGesture;
  readonly children: ReactNode;
}

// `isolate` keeps a lifted control's z-index inside the header, so it never
// paints over the thread's own overlays (sticky bars, scroll fades).
// A step reads at body size (14/20) on a 36px row, the kit's scale for a
// line a person reads, not a caption.
const HEADER_LAYOUT =
  "stg:relative stg:isolate stg:flex stg:w-full stg:items-center stg:gap-2 stg:px-3 stg:py-2 stg:text-sm";

const TOGGLE_CLASSES = cn(
  // z-1, not auto: a header child that draws with a transform (the open
  // chevron's rotation, a running spinner) is a stacking context of its own and
  // would paint over an auto toggle, swallowing its clicks. A lifted control's
  // z-10 still sits above it.
  "stg:absolute stg:inset-0 stg:z-1 stg:cursor-pointer",
  // ring-inset so the card's overflow-hidden does not clip the focus ring.
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
);

/** The thread card's one-line header. See the module doc for the contract. */
export function ThreadCardHeader({
  gesture = { kind: "none" },
  children,
}: ThreadCardHeaderProps) {
  if (gesture.kind === "none") {
    return <div className={HEADER_LAYOUT}>{children}</div>;
  }

  const toggle = (
    <button
      type="button"
      aria-label={gesture.label}
      aria-expanded={gesture.expanded}
      onClick={gesture.onToggle}
      data-cursor-target="thread-card-toggle"
      className={TOGGLE_CLASSES}
    />
  );

  return (
    <div
      className={cn(
        HEADER_LAYOUT,
        // Opened, the header keeps the row's own ground: the drawing shades
        // a header only under the pointer.
        "stg:transition-colors stg:hover:bg-muted-subtle",
      )}
    >
      {/* The Tooltip wraps the toggle whether or not a hint is set, so the
          button is never remounted (and never loses focus) when a resize
          cuts the subtitle off or lets it fit. */}
      <Tooltip disabled={gesture.hint === undefined}>
        <TooltipTrigger render={toggle} />
        {gesture.hint !== undefined && (
          <TooltipContent side="top" className="stg:break-all">
            {gesture.hint}
          </TooltipContent>
        )}
      </Tooltip>
      {children}
      <ChevronIcon expanded={gesture.expanded} />
    </div>
  );
}

/** Props for {@link ThreadCardHeaderControl}. */
export interface ThreadCardHeaderControlProps {
  /** Layout classes for the wrapper (`stg:shrink-0`, `stg:min-w-0`, …). */
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Lifts a control of the header's own (a file link, a Stop button) above the
 * `expand` toggle, so the pointer and a screen reader reach it as itself.
 * The header's toggle covers every pixel nothing is lifted over; anything
 * interactive in a header goes through this wrapper. Harmless in a `none`
 * header, so a control shared by both layouts can always use it.
 */
export function ThreadCardHeaderControl({ className, children }: ThreadCardHeaderControlProps) {
  return <span className={cn("stg:relative stg:z-10", className)}>{children}</span>;
}

// ---------------------------------------------------------------------------
// Body — the disclosed content area
// ---------------------------------------------------------------------------

/** Props for {@link ThreadCardBody}. */
export interface ThreadCardBodyProps {
  /** Optional element id (e.g. an `aria-controls` target). */
  readonly id?: string;
  /** Rendered as `data-cursor-target` for e2e targeting. */
  readonly cursorTarget?: string;
  /**
   * Body containment for a `"quiet"` shell: with no card border around it, a
   * disclosed body needs its own boundary — a light left rail (the
   * `ThinkingMessage` expanded-state precedent) instead of the card's padding
   * box. Ignored for card/row shells, whose frame already bounds the body.
   */
  readonly rail?: boolean;
  readonly children: ReactNode;
}

/** The thread card's body padding contract. */
export function ThreadCardBody({ id, cursorTarget, rail = false, children }: ThreadCardBodyProps) {
  return (
    <div
      id={id}
      data-cursor-target={cursorTarget}
      className={
        rail
          ? "stg:ml-1.5 stg:border-l-2 stg:border-border-muted stg:py-1 stg:pl-3 stg:pr-3"
          : "stg:px-3 stg:pb-3 stg:pt-1"
      }
    >
      {children}
    </div>
  );
}
