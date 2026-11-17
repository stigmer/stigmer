"use client";

// The console's one figure: a label over a value, in a card. The label is
// 12/16 medium in the muted tone, the value 24/32 semibold with tabular
// digits, an optional line under it 12/16 muted. A value carries a hue
// only when the value is itself a status (runs completed, runs failed);
// every other figure stays in the foreground, so hue keeps meaning status.
// This is the dashboard's tile as it passed the owner's look; usage's and
// billing's figures draw on it too, so a figure reads the same everywhere.
// Figures lays several out: two to a row on a phone, all of them on one
// row from the large breakpoint. Internal: the kit's own components use
// it; no host imports it yet.

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { Card } from "./Card.js";

/** The status a figure's value is, when it is one. */
export type FigureTone = "ready" | "failed";

/** Props for {@link Figure}. */
export interface FigureProps {
  /** What the figure counts ("Completed", "Tokens"). */
  readonly label: ReactNode;
  /** The figure itself, already formatted ("128", "18.4M"). */
  readonly value: ReactNode;
  /** One line under the value ("This week", "of 1,000,000"). */
  readonly line?: ReactNode;
  /** The value's hue, only when the value is a status. */
  readonly tone?: FigureTone;
  readonly className?: string;
}

const TONE_CLASSES: Record<FigureTone, string> = {
  ready: "stg:text-status-ready",
  failed: "stg:text-destructive",
};

/** A label over a value, in a card. */
export function Figure({ label, value, line, tone, className }: FigureProps) {
  return (
    <Card className={className}>
      <p className="stg:m-0 stg:text-xs stg:font-medium stg:text-muted-foreground">{label}</p>
      <p
        className={cn(
          "stg:m-0 stg:mt-1 stg:text-2xl stg:font-semibold stg:tabular-nums",
          tone ? TONE_CLASSES[tone] : "stg:text-foreground",
        )}
      >
        {value}
      </p>
      {line != null && <p className="stg:m-0 stg:mt-1 stg:text-xs stg:text-muted-foreground">{line}</p>}
    </Card>
  );
}

/** Props for {@link Figures}. */
export interface FiguresProps {
  /** The figures ({@link Figure}s). */
  readonly children: ReactNode;
  /** How many sit on one row on a wide page. @default 4 */
  readonly columns?: 2 | 3 | 4;
  /** Names the group for assistive technology ("This week's runs"). */
  readonly "aria-label"?: string;
  readonly className?: string;
}

const COLUMN_CLASSES: Record<2 | 3 | 4, string> = {
  2: "stg:grid-cols-2",
  3: "stg:grid-cols-2 stg:lg:grid-cols-3",
  4: "stg:grid-cols-2 stg:lg:grid-cols-4",
};

/** Several figures in a row: two to a row on a phone, `columns` from the large breakpoint. */
export function Figures({ children, columns = 4, "aria-label": ariaLabel, className }: FiguresProps) {
  return (
    <div
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      className={cn("stg:grid stg:gap-3", COLUMN_CLASSES[columns], className)}
    >
      {children}
    </div>
  );
}
