"use client";

/**
 * The sources, first on the Marketplace page: one chip per source with its
 * mark, its name and how many plugins it offers, "All sources" before them,
 * and Manage sources after. Choosing a chip narrows the grid to that
 * source; the chips are how a user learns where plugins come from before
 * they scroll.
 *
 * A WAI-ARIA radiogroup in the `ViewSwitcher` shape (roving tabindex, arrow
 * keys move and select). Each chip carries its source's read state: a
 * spinner while its catalogue is read, its entry count once read, a
 * warning mark with the refusal's sentence in a tooltip when it failed;
 * a failed chip stays selectable, and the grid shows the sentence with a
 * retry when it is.
 */

import { useCallback, useRef } from "react";
import { cn } from "@stigmer/theme";

import { Button } from "../button/Button.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { SourceMark } from "./SourceMark.js";
import type { SourceRead } from "./catalog-store.js";

/** Props for {@link SourceChips}. */
export interface SourceChipsProps {
  readonly reads: readonly SourceRead[];
  /** The selected source's name, or `null` for every source. */
  readonly selected: string | null;
  readonly onSelect: (name: string | null) => void;
  readonly onManage: () => void;
  readonly className?: string;
}

/** The value the "All sources" radio carries; a source cannot be named this (an empty name fails the plugin name rule). */
const ALL = "";

const CHIP_CLASSES = cn(
  "stg:inline-flex stg:cursor-pointer stg:items-center stg:gap-1.5 stg:rounded-full stg:border stg:px-3 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
);
const CHIP_SELECTED = "stg:border-primary stg:bg-primary stg:text-primary-foreground";
const CHIP_IDLE = "stg:border-border stg:bg-card stg:text-muted-foreground stg:hover:bg-accent-hover stg:hover:text-foreground";

export function SourceChips({ reads, selected, onSelect, onManage, className }: SourceChipsProps) {
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const values = [ALL, ...reads.map((read) => read.marketplace.name)];
  const current = selected ?? ALL;

  const select = useCallback(
    (value: string) => {
      onSelect(value === ALL ? null : value);
    },
    [onSelect],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let next: number | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % values.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + values.length) % values.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = values.length - 1;
      if (next === null) return;
      event.preventDefault();
      chipRefs.current[next]?.focus();
      const value = values[next];
      if (value !== undefined) select(value);
    },
    [values, select],
  );

  const total = reads.reduce((sum, read) => sum + (read.state.kind === "ready" ? read.state.opened.marketplace.plugins.length : 0), 0);
  const anyReading = reads.some((read) => read.state.kind === "reading");

  return (
    <div className={cn("stg:flex stg:flex-wrap stg:items-center stg:gap-2", className)}>
      <div role="radiogroup" aria-label="Sources" className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
        <Chip
          ref={(element) => {
            chipRefs.current[0] = element;
          }}
          selected={current === ALL}
          label="All sources"
          onClick={() => select(ALL)}
          onKeyDown={(event) => handleKeyDown(event, 0)}
        >
          <span>All sources</span>
          <Count count={total} reading={anyReading} />
        </Chip>
        {reads.map((read, index) => (
          <SourceChip
            key={read.marketplace.name}
            ref={(element) => {
              chipRefs.current[index + 1] = element;
            }}
            read={read}
            selected={current === read.marketplace.name}
            onClick={() => select(read.marketplace.name)}
            onKeyDown={(event) => handleKeyDown(event, index + 1)}
          />
        ))}
      </div>
      <Button variant="ghost" size="xs" onClick={onManage} className="stg:text-muted-foreground">
        Manage sources
      </Button>
    </div>
  );
}

function SourceChip({
  ref,
  read,
  selected,
  onClick,
  onKeyDown,
}: {
  readonly ref: React.Ref<HTMLButtonElement>;
  readonly read: SourceRead;
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const { marketplace, state } = read;
  const chip = (
    <Chip ref={ref} selected={selected} label={marketplace.name} onClick={onClick} onKeyDown={onKeyDown}>
      <SourceMark source={marketplace.source} />
      <span>{marketplace.name}</span>
      {state.kind === "ready" && <Count count={state.opened.marketplace.plugins.length} reading={false} />}
      {state.kind === "reading" && <SpinnerIcon className="stg:size-3" />}
      {state.kind === "failed" && <WarningGlyph className="stg:size-3" />}
    </Chip>
  );
  if (state.kind !== "failed") return chip;
  // The refusal's sentence travels with the mark; the grid repeats it with a retry when the chip is chosen.
  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipContent side="bottom">{state.error.message}</TooltipContent>
    </Tooltip>
  );
}

function Chip({
  ref,
  selected,
  label,
  onClick,
  onKeyDown,
  children,
}: {
  readonly ref: React.Ref<HTMLButtonElement>;
  readonly selected: boolean;
  readonly label: string;
  readonly onClick: () => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      ref={ref}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      tabIndex={selected ? 0 : -1}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(CHIP_CLASSES, selected ? CHIP_SELECTED : CHIP_IDLE)}
    >
      {children}
    </button>
  );
}

/** The entry count once known; a spinner while the first catalogue is still on its way. */
function Count({ count, reading }: { readonly count: number; readonly reading: boolean }) {
  if (reading && count === 0) return <SpinnerIcon className="stg:size-3" />;
  return <span className="stg:tabular-nums">{count}</span>;
}

function WarningGlyph({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2.5 14 13H2L8 2.5Z" />
      <path d="M8 6.5v3M8 11.5h.01" />
    </svg>
  );
}
