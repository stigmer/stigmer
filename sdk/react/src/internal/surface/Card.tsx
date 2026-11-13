"use client";

// The console's one card: a bordered surface on the card fill, with a 10px
// corner and 16px inside. Every card component (a plan, a plugin, a
// provider, a template, a dashboard figure) draws its box here, so a card
// on settings and a card on the dashboard are the same object. Internal:
// the kit's own components use it; no host imports it yet.

import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@stigmer/design-tokens";

/** How a card is drawn. */
export interface CardLook {
  /** The card opens or picks something: a hover border and the focus ring. */
  readonly interactive?: boolean;
  /** The card is the chosen one of a set (a plan, a template). */
  readonly selected?: boolean;
  /** A card that adds a thing ("Add a provider"): dashed, on the page. */
  readonly placeholder?: boolean;
  /** No inner padding, for a card whose content draws its own (a list, a table, a header bar). */
  readonly flush?: boolean;
}

/**
 * The card's classes, for a card that must itself be a link or a button
 * (a whole-card link from a host's `renderLink`, a picker's option).
 */
export function cardClasses({ interactive, selected, placeholder, flush }: CardLook = {}): string {
  return cn(
    "stg:block stg:min-w-0 stg:rounded-xl stg:border stg:text-card-foreground",
    placeholder ? "stg:border-dashed stg:border-border-prominent stg:bg-transparent" : "stg:bg-card",
    selected ? "stg:border-foreground" : !placeholder && "stg:border-border",
    flush ? "stg:overflow-hidden" : "stg:p-4",
    interactive &&
      "stg:cursor-pointer stg:text-left stg:transition-colors stg:hover:border-border-prominent stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
    interactive && selected && "stg:hover:border-foreground",
  );
}

/** Props for {@link Card}. */
export interface CardProps extends CardLook, HTMLAttributes<HTMLDivElement> {}

/** A card: the kit's bordered surface. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive, selected, placeholder, flush, className, ...rest },
  ref,
) {
  return <div ref={ref} className={cn(cardClasses({ interactive, selected, placeholder, flush }), className)} {...rest} />;
});

/** A card's header bar: its title at the left, its acts at the right, a hairline below. */
export function cardHeaderClasses(): string {
  return "stg:flex stg:items-center stg:justify-between stg:gap-3 stg:border-b stg:border-border-muted stg:px-4 stg:py-3";
}
