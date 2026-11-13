"use client";

// The console's one list: rows in a card with hairline dividers. Every
// settings list (vaults, keys, members, teams, apps) and the workbench's
// list draw their rows here, so a row reads the same on every page: what
// it is at the left, a second line under its name, its state and acts at
// the right. A row that opens something carries its link or button on the
// name and stretches its hit area over the row, so the row's own buttons
// are never nested inside another control and every row is reached by Tab.
// Internal: the kit's own components use it; no host imports it yet.

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { UNSTYLED_LIST } from "../element-resets.js";
import { anchorLink, type RenderLink } from "../../button/LinkButton.js";
import { cardClasses } from "./Card.js";

/** Props for {@link List}. */
export interface ListProps {
  /** The rows ({@link ListRow}s). */
  readonly children: ReactNode;
  /** The list's accessible name, when the heading above doesn't give one. */
  readonly "aria-label"?: string;
  /** The id of the heading that names the list. */
  readonly "aria-labelledby"?: string;
  /** Rows with no card around them, for a list already inside a card. */
  readonly bare?: boolean;
  readonly className?: string;
}

/** A list of rows in a card, with hairline dividers between them. */
export function List({ children, bare, className, ...aria }: ListProps) {
  return (
    // role="list": Safari drops list semantics from a `ul` drawn without bullets.
    <ul
      role="list"
      {...aria}
      className={cn(UNSTYLED_LIST, !bare && cardClasses({ flush: true }), "stg:divide-y stg:divide-border-muted", className)}
    >
      {children}
    </ul>
  );
}

/** Props for {@link ListRow}. */
export interface ListRowProps {
  /** The row's name: what the thing is called. */
  readonly name: ReactNode;
  /** One line under the name (a slug, a date, who made it). */
  readonly description?: ReactNode;
  /** Before the name: an icon, an avatar, a checkbox. */
  readonly leading?: ReactNode;
  /** After the name, on the name's line: a tag beside the name ("You", "Default"). */
  readonly nameAdornment?: ReactNode;
  /** At the right: a status pill, tags, a time, the row's icon buttons. */
  readonly trailing?: ReactNode;
  /** Drawn under the row, inside it, when the row is open. */
  readonly expanded?: ReactNode;
  /** The row is open: a faint fill and its `expanded` content shown. */
  readonly open?: boolean;
  /** The row goes somewhere: its name is a link to here, stretched over the row. */
  readonly href?: string;
  /** Draws the name's link; a plain `<a>` when omitted. */
  readonly renderLink?: RenderLink;
  /** The row does something: its name is a button, stretched over the row. */
  readonly onClick?: () => void;
  /** For a row whose name is a button: whether the row is open (a disclosure). */
  readonly "aria-expanded"?: boolean;
  readonly className?: string;
}

const STRETCH =
  "stg:min-w-0 stg:truncate stg:text-left stg:text-foreground stg:no-underline stg:outline-none stg:after:absolute stg:after:inset-0 stg:after:content-[''] stg:focus-visible:after:rounded-[inherit] stg:focus-visible:after:ring-2 stg:focus-visible:after:ring-inset stg:focus-visible:after:ring-ring";

/**
 * One row of a {@link List}: 40px for a one-line row, 10px top and bottom,
 * 14px at the sides.
 */
export function ListRow({
  name,
  description,
  leading,
  nameAdornment,
  trailing,
  expanded,
  open = false,
  href,
  renderLink = anchorLink,
  onClick,
  "aria-expanded": ariaExpanded,
  className,
}: ListRowProps) {
  const interactive = href != null || onClick != null;
  const nameNode =
    href != null ? (
      renderLink({ href, className: STRETCH, children: name })
    ) : onClick != null ? (
      <button type="button" onClick={onClick} aria-expanded={ariaExpanded} className={cn(STRETCH, "stg:font-medium")}>
        {name}
      </button>
    ) : (
      <span className="stg:min-w-0 stg:truncate">{name}</span>
    );

  return (
    <li className={cn(open && "stg:bg-muted-faint", className)}>
      <div
        className={cn(
          "stg:relative stg:flex stg:min-h-10 stg:items-center stg:gap-3 stg:px-3.5 stg:py-2.5 stg:text-sm",
          interactive && "stg:transition-colors stg:hover:bg-accent",
        )}
      >
        {leading != null && <div className="stg:flex stg:shrink-0 stg:items-center">{leading}</div>}
        <div className="stg:flex stg:min-w-0 stg:flex-1 stg:flex-col">
          <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2 stg:font-medium stg:text-foreground">
            {nameNode}
            {nameAdornment != null && <span className="stg:relative stg:z-10 stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">{nameAdornment}</span>}
          </div>
          {description != null && <div className="stg:truncate stg:text-xs stg:text-muted-foreground">{description}</div>}
        </div>
        {trailing != null && <div className="stg:relative stg:z-10 stg:flex stg:shrink-0 stg:items-center stg:gap-2">{trailing}</div>}
      </div>
      {open && expanded != null && (
        <div className="stg:border-t stg:border-border-muted stg:px-3.5 stg:py-3">{expanded}</div>
      )}
    </li>
  );
}
