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
 * - {@link ThreadCardStep} — a step's own layout (a tool call, a helper, a
 *   plan's to-do): one grid of the mark, the words (its line and the line
 *   under it), the trail (badges, the time, the chevron) and the opened
 *   body, so the body starts under the step's words and ends before its
 *   trail, for every kind. The header and body above stay the quiet rows'
 *   layout (a thought, recalled memories) and the approval's.
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
  // pointer-events-auto: a step's words take no pointer (its toggle below
  // them does), and a control among them takes it back.
  return <span className={cn("stg:pointer-events-auto stg:relative stg:z-10", className)}>{children}</span>;
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

// ---------------------------------------------------------------------------
// Step — one grid for every step
// ---------------------------------------------------------------------------

/**
 * A step's primary gesture: the header's (`none`, `expand`), or `open`, a
 * line whose act is to open what it names elsewhere (a File a turn wrote
 * opens in the panel), with no body and no chevron.
 */
export type ThreadCardStepGesture =
  | ThreadCardHeaderGesture
  | { readonly kind: "open"; readonly onOpen: () => void; readonly label: string };

/** Props for {@link ThreadCardStep}. */
export interface ThreadCardStepProps {
  /** The primary gesture. Defaults to `{ kind: "none" }`. */
  readonly gesture?: ThreadCardStepGesture;
  /** The leading mark: the tick, the spinner, the red (!), a ring. */
  readonly mark: ReactNode;
  /** The step's line: its words and what sits right after them (a tag, an exit code). */
  readonly title: ReactNode;
  /**
   * The line's own tone: its weight and colour, set on the line as a whole as
   * the drawing sets it (`stg:font-medium` while it works or once it failed,
   * the muted foreground once it is done), so a tag after the words keeps its
   * own and a reader reads the line's.
   */
  readonly titleClassName?: string;
  /** The line under it, 12/16 muted: what came of the step and where. */
  readonly detail?: ReactNode;
  /** Ref to the line under the words, to measure whether it was cut short. */
  readonly detailRef?: Ref<HTMLSpanElement>;
  /** The trailing column, aligned to the line: badges, the time, a Stop. The chevron follows it. */
  readonly trail?: ReactNode;
  /** The opened body; drawn when given. */
  readonly body?: ReactNode;
  /**
   * Where the body sits: under the words and ending before the trail
   * (`"words"`, a tool's contents in their box), or under the words through
   * the trail's column (`"rail"`, the steps a to-do or a helper took, on
   * their rail). Defaults to `"words"`.
   */
  readonly bodySpan?: "words" | "rail";
  /** The body's element id, which the toggle names as what it controls. */
  readonly bodyId?: string;
  /** Rendered as `data-cursor-target` on the body for e2e targeting. */
  readonly bodyCursorTarget?: string;
  /**
   * Where the step sits: on its own or as a row of a card of steps
   * (`"card"`, 8px 12px inside), or on a rail under a to-do or a helper
   * (`"rail"`, 4px above and below, no side padding: the rail is the inset).
   * Defaults to `"card"`.
   */
  readonly place?: "card" | "rail";
  /** Draw the step on the running band (a plan's to-do worked on now). */
  readonly band?: boolean;
  /** Additional CSS class names for the grid. */
  readonly className?: string;
}

/**
 * A step's layout: the drawing's `.step` (the session page, S33 to S38), a
 * grid of a 20px mark column, the words, and the trail. The opened body is
 * the grid's second row, so it starts under the step's words and ends before
 * its trail whatever the trail holds (a tag, a badge, a time, Stop), which no
 * padding by the mark's width could do.
 *
 * The toggle keeps the module's contract (an empty button named by the
 * caller, a lifted control reached as itself) and is placed in the first
 * row's grid area, stretched over the row's padding, so it covers the line
 * and never the body, whose text stays selectable. The line's parts take no
 * pointer, so a click anywhere on the line reaches the toggle, and they
 * paint over it, so its hover shade sits under the words.
 *
 * `data-step-title`, `data-step-body` (with its span) and `data-step-trail`
 * mark the words, the body and the trail for the design facts test, which
 * checks that the body starts where the words do and, under the words
 * alone, ends before the trail.
 */
export function ThreadCardStep({
  gesture = { kind: "none" },
  mark,
  title,
  titleClassName,
  detail,
  detailRef,
  trail,
  body,
  bodySpan = "words",
  bodyId,
  bodyCursorTarget,
  place = "card",
  band = false,
  className,
}: ThreadCardStepProps) {
  const hasBody = body !== undefined && body !== null && body !== false;
  const toggle =
    gesture.kind !== "none" ? (
      <button
        type="button"
        aria-label={gesture.label}
        {...(gesture.kind === "expand" ? { "aria-expanded": gesture.expanded } : {})}
        {...(gesture.kind === "expand" && bodyId !== undefined && hasBody ? { "aria-controls": bodyId } : {})}
        onClick={gesture.kind === "expand" ? gesture.onToggle : gesture.onOpen}
        data-cursor-target="thread-card-toggle"
        className={cn(
          // The first row's area, stretched over the row's padding: the
          // whole line is the toggle, the body never. Both row lines are
          // named: an absolutely placed grid item's `auto` end is the grid's
          // own edge, which would lay the toggle over the body.
          "stg:absolute stg:col-span-full stg:row-start-1 stg:row-end-2 stg:cursor-pointer stg:transition-colors stg:hover:bg-muted-subtle",
          place === "card" ? "stg:-inset-x-3 stg:-top-2" : "stg:inset-x-0 stg:-top-1",
          place === "card" ? (hasBody ? "stg:-bottom-1" : "stg:-bottom-2") : hasBody ? "stg:-bottom-0.5" : "stg:-bottom-1",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
        )}
      />
    ) : null;
  const lineParts = "stg:pointer-events-none stg:relative stg:row-start-1";
  return (
    <div
      className={cn(
        "stg:relative stg:isolate stg:grid stg:grid-cols-[1.25rem_minmax(0,1fr)_auto] stg:gap-x-2 stg:text-sm",
        place === "card" ? "stg:px-3 stg:py-2" : "stg:py-1",
        band && "stg:bg-status-running-band",
        className,
      )}
    >
      {toggle !== null && gesture.kind === "open" && toggle}
      {toggle !== null && gesture.kind === "expand" && (
        // The Tooltip wraps the toggle whether or not a hint is set, so the
        // button is never remounted (and never loses focus) when a resize
        // cuts the line off or lets it fit.
        <Tooltip disabled={gesture.hint === undefined}>
          <TooltipTrigger render={toggle} />
          {gesture.hint !== undefined && (
            <TooltipContent side="top" className="stg:break-all">
              {gesture.hint}
            </TooltipContent>
          )}
        </Tooltip>
      )}
      <span className={cn(lineParts, "stg:col-start-1 stg:flex stg:h-5 stg:items-center stg:justify-center")}>{mark}</span>
      <span className={cn(lineParts, "stg:col-start-2 stg:flex stg:min-w-0 stg:flex-col")}>
        {/* Each line is one run of words, as the drawing sets it: what sits
            after the words (a tag, an exit code, the app) flows with them,
            and the line is cut short as a whole. */}
        <span data-step-title="" className={cn("stg:block stg:min-w-0 stg:truncate", titleClassName)}>
          {title}
        </span>
        {detail !== undefined && detail !== null && detail !== false && (
          <span ref={detailRef} className="stg:block stg:min-w-0 stg:truncate stg:text-xs stg:text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      {/* The trail at 12/16, the drawing's `.tm`: the time, a badge, a Stop. */}
      <span data-step-trail="" className={cn(lineParts, "stg:col-start-3 stg:flex stg:min-h-5 stg:items-center stg:gap-2 stg:self-start stg:text-xs")}>
        {trail}
        {gesture.kind === "expand" && <ChevronIcon expanded={gesture.expanded} />}
      </span>
      {hasBody && (
        <div
          id={bodyId}
          data-step-body={bodySpan}
          data-cursor-target={bodyCursorTarget}
          className={cn(
            "stg:row-start-2 stg:min-w-0 stg:mt-1",
            bodySpan === "rail" ? "stg:col-start-2 stg:col-end-4" : "stg:col-start-2",
          )}
        >
          {body}
        </div>
      )}
    </div>
  );
}
