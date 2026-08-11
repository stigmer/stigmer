"use client";

import type { ReactNode, Ref } from "react";
import { cn } from "@stigmer/theme";
import { ChevronIcon } from "./glyphs.js";

/**
 * The shared card shell for thread rows — session tool-call cards and
 * workflow task cards compose the SAME chrome, header gestures, and body
 * contract, so the two threads read as one visual language by
 * construction (T05). Extracted from `ToolCallItem`, whose DOM is the
 * canonical anatomy; the workflow card adopted it in the same change.
 *
 * Three pieces, composed via children (slots-as-children, never a
 * mega-prop card — each thread's composition stays explicit):
 *
 * - {@link ThreadCardShell} — the chrome: bordered card vs divider row,
 *   pending-gate accent.
 * - {@link ThreadCardHeader} — the one-line header region with a
 *   primary gesture: `expand` (summary rows, `aria-expanded`, appends
 *   the chevron) or `none` (preview rows — their body is always
 *   visible, so the header has no job beyond layout).
 * - {@link ThreadCardBody} — the disclosed content area's padding
 *   contract.
 *
 * The shell owns layout + chrome + a11y, nothing more: no data fetching,
 * no presenters, no disclosure policy (those stay per-thread). It renders
 * beneath the threads' memoized row components and takes only primitives
 * and stable callbacks, so it never disturbs their memo bails
 * (DD-009/DD-010).
 *
 * Interactive headers are `div[role=button]`, not `<button>` — they may
 * carry nested action buttons, and a `<button>` may not contain another.
 * Nested buttons must `stopPropagation` so their click never fires the
 * header's primary gesture.
 *
 * @internal Not part of the public API.
 */

// ---------------------------------------------------------------------------
// Shell — the card chrome
// ---------------------------------------------------------------------------

/** Props for {@link ThreadCardShell}. */
export interface ThreadCardShellProps {
  /**
   * Whether the row renders as its own self-contained card (a thin rounded
   * border). Set to `false` when nested inside a container that already
   * provides the border — e.g. the folded `ToolRunGroup` chip — where the
   * row degrades to a divider-separated row to avoid a card-in-a-card.
   */
  readonly bordered?: boolean;
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

/** The thread card's outer chrome. See the module doc for the full contract. */
export function ThreadCardShell({
  bordered = true,
  accent = null,
  cursorTarget,
  className,
  ref,
  children,
}: ThreadCardShellProps) {
  const chrome = bordered
    ? cn(
        // border-prominent (not border): a transparent card needs a line the
        // eye actually catches — the default border token is white at 14%
        // opacity, which vanishes on the dark thread surface.
        "stg:rounded-lg stg:border stg:border-border-prominent stg:overflow-hidden",
        accent === "warning" && "stg:border-l-2 stg:border-l-warning",
        accent === "destructive" && "stg:border-l-2 stg:border-l-destructive",
      )
    : "stg:border-b stg:border-border-muted stg:last:border-b-0";

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
 * (`aria-expanded`; the chevron is appended automatically). `none` renders
 * a non-interactive layout row (preview cards — their body is always
 * visible).
 */
export type ThreadCardHeaderGesture =
  | { readonly kind: "none" }
  | {
      readonly kind: "expand";
      readonly expanded: boolean;
      readonly onToggle: () => void;
    };

/** Props for {@link ThreadCardHeader}. */
export interface ThreadCardHeaderProps {
  /** The primary gesture. Defaults to `{ kind: "none" }`. */
  readonly gesture?: ThreadCardHeaderGesture;
  /** Accessible label for interactive headers whose content is not self-describing. */
  readonly ariaLabel?: string;
  readonly children: ReactNode;
}

const HEADER_LAYOUT = "stg:flex stg:w-full stg:items-center stg:gap-2 stg:px-2.5 stg:py-1.5 stg:text-xs";

const HEADER_INTERACTIVE = cn(
  "stg:cursor-pointer stg:text-left stg:transition-colors",
  "stg:hover:bg-muted-subtle",
  // ring-inset so the card's overflow-hidden does not clip the focus ring.
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
);

/** The thread card's one-line header. See the module doc for the contract. */
export function ThreadCardHeader({
  gesture = { kind: "none" },
  ariaLabel,
  children,
}: ThreadCardHeaderProps) {
  if (gesture.kind === "none") {
    return <div className={HEADER_LAYOUT}>{children}</div>;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-expanded={gesture.expanded}
      onClick={gesture.onToggle}
      onKeyDown={(e) => {
        // Only when the header itself is focused: a nested action button's
        // Enter/Space fires its own click and must not ALSO trigger the
        // header's primary gesture as the keydown bubbles up.
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          gesture.onToggle();
        }
      }}
      className={cn(
        HEADER_LAYOUT,
        HEADER_INTERACTIVE,
        gesture.expanded && "stg:bg-muted-faint",
      )}
    >
      {children}
      <ChevronIcon expanded={gesture.expanded} />
    </div>
  );
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
  readonly children: ReactNode;
}

/** The thread card's body padding contract. */
export function ThreadCardBody({ id, cursorTarget, children }: ThreadCardBodyProps) {
  return (
    <div id={id} data-cursor-target={cursorTarget} className="stg:px-2.5 stg:pb-2.5 stg:pt-1">
      {children}
    </div>
  );
}
