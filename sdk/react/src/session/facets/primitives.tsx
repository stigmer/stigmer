"use client";

// Shared visual vocabulary for the session-panel facets (Config / Changes /
// Artifacts / Usage): one dense, VS Code-style row-and-section language so the
// facets read as one surface instead of three eras of styling. The Artifacts
// facet's `ArtifactRowView` set the idiom — compact rows, quiet metadata,
// hover/focus-revealed actions — and these primitives carry it to the
// non-file-list facets. All visual properties flow through `--stgm-*`
// tokens (DD-005).

import { cn } from "@stigmer/theme";

/**
 * A titled facet section: uppercase micro-heading over flush content.
 * `count` renders the "(N)" suffix the retired inspector used; `annotation`
 * renders a normal-case, muted trailing note (e.g. "next message only").
 */
export function FacetSection({
  heading,
  count,
  annotation,
  children,
}: {
  readonly heading: string;
  readonly count?: number;
  readonly annotation?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="stg:flex stg:flex-col stg:gap-1">
      <h3 className="stg:px-2 stg:text-[0.65rem] stg:font-semibold stg:uppercase stg:tracking-wider stg:text-muted-foreground">
        {heading}
        {count != null && count > 0 && (
          <span className="stg:ml-1 stg:text-muted-foreground-faint">({count})</span>
        )}
        {annotation && (
          <span className="stg:ml-1 stg:font-normal stg:normal-case stg:tracking-normal stg:text-muted-foreground-faint">
            ({annotation})
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

/**
 * One dense, non-interactive facet row: leading content, optional
 * right-aligned metadata, and hover/focus-revealed trailing actions
 * (the `group` the actions' reveal keys on). Interactive rows (whole-row
 * buttons) build on {@link FACET_ROW_BUTTON} instead.
 */
export function FacetRow({
  children,
  meta,
  actions,
  className,
}: {
  readonly children: React.ReactNode;
  /** Right-aligned quiet metadata (counts, sizes, values). */
  readonly meta?: React.ReactNode;
  /** Hover/focus-revealed trailing controls — siblings, never nested. */
  readonly actions?: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "stg:group stg:flex stg:items-center stg:gap-2 stg:px-2 stg:py-1 stg:text-xs",
        className,
      )}
    >
      <span className="stg:flex stg:min-w-0 stg:flex-1 stg:items-center stg:gap-2 stg:text-foreground">
        {children}
      </span>
      {meta && (
        <span className="stg:shrink-0 stg:text-[0.65rem] stg:text-muted-foreground">
          {meta}
        </span>
      )}
      {actions}
    </div>
  );
}

/**
 * Class string for a whole-row interactive facet action (the
 * `ArtifactRowView` open-button idiom): dense row metrics plus hover and
 * focus-visible treatments. A string constant (not a component) so callers
 * keep their own element type and extra classes.
 */
export const FACET_ROW_BUTTON = cn(
  "stg:flex stg:w-full stg:min-w-0 stg:items-center stg:gap-2 stg:px-2 stg:py-1 stg:text-left stg:text-xs stg:text-muted-foreground stg:transition-colors",
  "stg:hover:bg-muted stg:hover:text-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);

/**
 * Hover/focus-revealed remove control for a {@link FacetRow} — the
 * `ArtifactRowView` download-button reveal pattern applied to removal.
 * Always reachable by keyboard (focus reveals it without hover).
 */
export function FacetRemoveButton({
  onClick,
  label,
}: {
  readonly onClick: () => void;
  readonly label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "stg:flex stg:shrink-0 stg:items-center stg:text-muted-foreground stg:opacity-0 stg:transition-opacity",
        "stg:group-hover:opacity-100 stg:focus-visible:opacity-100",
        "stg:hover:text-destructive",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
      )}
    >
      <FacetXIcon />
    </button>
  );
}

/** Muted empty-state line for a facet section with nothing to list. */
export function FacetEmptyHint({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="stg:px-2 stg:text-xs stg:text-muted-foreground-faint">{children}</p>
  );
}

/**
 * A key→value config row ("Harness  Native"): muted label left, value
 * right — the dense inverse of a definition list, sized like every other
 * facet row. `children` is the value; pass a control (e.g. a Switch) for
 * interactive config rows.
 */
export function FacetKeyValueRow({
  label,
  labelId,
  children,
}: {
  readonly label: string;
  /** Optional id for the label span — point a control's `aria-labelledby` here. */
  readonly labelId?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="stg:flex stg:items-center stg:justify-between stg:gap-2 stg:px-2 stg:py-1 stg:text-xs">
      <span id={labelId} className="stg:shrink-0 stg:text-muted-foreground">
        {label}
      </span>
      <span className="stg:flex stg:min-w-0 stg:items-center stg:gap-1.5 stg:truncate stg:text-foreground">
        {children}
      </span>
    </div>
  );
}

function FacetXIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4L10 10M10 4L4 10" />
    </svg>
  );
}
