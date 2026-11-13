"use client";

// The console's one neutral label: a word or a number on the muted fill (a
// role, "You", a model, a count). No dot and no hue, so a label never reads
// as a state; a state is the status pill (`StatusBadge`). Internal: the
// kit's own components use it.

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";

/** Props for {@link Tag}. */
export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  readonly children: ReactNode;
  /** An identifier (a slug, a key's prefix): the monospace face at normal weight. */
  readonly mono?: boolean;
}

/** The tag's classes, for a label that must itself be another element. */
export function tagClasses({ mono = false }: { readonly mono?: boolean } = {}): string {
  return cn(
    "stg:inline-flex stg:h-5 stg:shrink-0 stg:items-center stg:gap-1 stg:whitespace-nowrap stg:rounded-md stg:bg-muted stg:px-1.5 stg:text-xs stg:tabular-nums stg:text-foreground",
    mono ? "stg:font-mono stg:font-normal" : "stg:font-medium",
  );
}

/** A neutral label: 12px on a 20px muted chip. */
export function Tag({ children, mono, className, ...rest }: TagProps) {
  return (
    <span className={cn(tagClasses({ mono }), className)} {...rest}>
      {children}
    </span>
  );
}
