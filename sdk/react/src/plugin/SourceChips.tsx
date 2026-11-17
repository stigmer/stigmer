"use client";

/**
 * The sources, first on the Marketplace page: the kit's segmented choice
 * (`ChoiceGroup`), "All sources" first, then one choice per source with its
 * mark, its name and how many plugins it offers, and Manage sources beside
 * them. Choosing one narrows the grid to that source; the counts are how a
 * user learns where plugins come from before they scroll.
 *
 * Each choice carries its source's read state: a spinner while its
 * catalogue is read, its entry count once read, a warning mark when it
 * failed. A failed source stays choosable; the page says its refusal in one
 * notice above the grid, and the grid repeats it with a retry when the
 * source is the one chosen. Each choice is named by its source alone, so
 * its count and marks never change what a screen reader calls it.
 */

import { cn } from "@stigmer/design-tokens";

import { Button } from "../button/Button.js";
import { ChoiceGroup, type ChoiceOption } from "../internal/form/ChoiceGroup.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
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

/** The value "All sources" carries; a source cannot be named this (an empty name fails the plugin name rule). */
const ALL = "";

export function SourceChips({ reads, selected, onSelect, onManage, className }: SourceChipsProps) {
  const total = reads.reduce((sum, read) => sum + (read.state.kind === "ready" ? read.state.opened.marketplace.plugins.length : 0), 0);
  const anyReading = reads.some((read) => read.state.kind === "reading");

  const options: ChoiceOption<string>[] = [
    {
      value: ALL,
      "aria-label": "All sources",
      label: (
        <>
          <span>All sources</span>
          <Count count={total} reading={anyReading} />
        </>
      ),
    },
    ...reads.map((read): ChoiceOption<string> => {
      const { marketplace, state } = read;
      return {
        value: marketplace.name,
        "aria-label": marketplace.name,
        label: (
          <>
            <SourceMark source={marketplace.source} />
            <span>{marketplace.name}</span>
            {state.kind === "ready" && <Count count={state.opened.marketplace.plugins.length} reading={false} />}
            {state.kind === "reading" && <SpinnerIcon className="stg:size-3" />}
            {state.kind === "failed" && <WarningGlyph className="stg:size-3" />}
          </>
        ),
      };
    }),
  ];

  return (
    <div className={cn("stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-2", className)}>
      <ChoiceGroup
        aria-label="Sources"
        size="xs"
        value={selected ?? ALL}
        onChange={(value) => onSelect(value === ALL ? null : value)}
        options={options}
      />
      <Button variant="ghost" size="xs" onClick={onManage}>
        Manage sources
      </Button>
    </div>
  );
}

/** The entry count once known; a spinner while the first catalogue is still on its way. */
function Count({ count, reading }: { readonly count: number; readonly reading: boolean }) {
  if (reading && count === 0) return <SpinnerIcon className="stg:size-3" />;
  return <span className="stg:tabular-nums stg:text-muted-foreground">{count}</span>;
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
