"use client";

/**
 * One plugin in the Marketplace grid: its face, the name for people, who
 * made it, what it does, where it comes from, and Install. Where the
 * person may not install (a member: installing is an organization admin's
 * act), the host passes no `onInstall` and the card says "Ask an admin to
 * install" instead of offering a button the server would refuse.
 *
 * The card reads its own presentation when it is shown (one manifest, see
 * `usePluginPresentation`), so the grid lists a catalogue from one file and
 * pays for a face only per visible card. Until the manifest arrives the
 * card wears its monogram and the catalogue's own name and description;
 * the display name, author and logo replace them as they land. The
 * Install button keeps the install name in its accessible name (`Install
 * thermos`), the word the CLI and the install dialog use.
 *
 * `UploadTile` is the card's sibling for "your computer": the same shape,
 * a dashed border, one action. It sits first in the grid so uploading reads
 * as one more place plugins come from, not as a form somewhere else.
 */

import { cn } from "@stigmer/design-tokens";

import { Button } from "../button/Button.js";
import { cardClasses } from "../internal/surface/Card.js";
import { StatusBadge } from "../status/StatusBadge.js";
import { UploadIcon } from "../internal/UploadIcon.js";
import { PluginFace } from "./PluginFace.js";
import { SourceMark } from "./SourceMark.js";
import type { CatalogEntry } from "./useMarketplaceCatalog.js";
import { usePluginPresentation } from "./usePluginPresentation.js";

/** Props for {@link PluginCard}. */
export interface PluginCardProps {
  readonly entry: CatalogEntry;
  /** Whether the organization already holds a plugin of this name. */
  readonly installed: boolean;
  /**
   * Opens the install for this entry. Absent where the person may not
   * install (a member: installing is an admin's), and the card says who can
   * instead of offering an Install the server would refuse.
   */
  readonly onInstall?: (entry: CatalogEntry) => void;
  readonly className?: string;
}

const CARD_LAYOUT = "stg:flex stg:flex-col stg:gap-3";

export function PluginCard({ entry, installed, onInstall, className }: PluginCardProps) {
  const { presentation, logoUrl } = usePluginPresentation(entry.opened, entry.entry);
  const name = entry.entry.name;
  const displayName = presentation.displayName ?? name;
  const description = entry.entry.description ?? presentation.description;
  const author = presentation.author?.name;
  // The line under the title: the author when the manifest names one; the install name when it differs
  // from the display name; nothing while the manifest is still on its way, so a name is never shown twice.
  const byline = author ? `by ${author}` : displayName !== name ? name : null;

  return (
    <li className={cn(cardClasses(), CARD_LAYOUT, className)}>
      <div className="stg:flex stg:items-start stg:gap-3 stg:min-w-0">
        <PluginFace name={name} displayName={displayName} logoUrl={logoUrl} />
        <div className="stg:min-w-0 stg:flex-1">
          <div className="stg:flex stg:items-start stg:justify-between stg:gap-2">
            <h3 className="stg:m-0 stg:truncate stg:text-sm stg:font-semibold stg:text-foreground">{displayName}</h3>
            {installed && (
              <StatusBadge phase="ready" label="Installed" />
            )}
          </div>
          {byline && <p className="stg:truncate stg:text-xs stg:text-muted-foreground">{byline}</p>}
        </div>
      </div>
      {description && <p className="stg:line-clamp-2 stg:flex-1 stg:text-xs stg:text-muted-foreground">{description}</p>}
      <div className="stg:mt-auto stg:flex stg:items-center stg:justify-between stg:gap-2 stg:pt-1">
        <span className="stg:flex stg:min-w-0 stg:items-center stg:gap-1.5 stg:text-xs stg:text-muted-foreground">
          <SourceMark source={entry.source.source} />
          <span className="stg:truncate">{entry.source.name}</span>
        </span>
        {onInstall ? (
          <Button variant="outline" size="xs" onClick={() => onInstall(entry)} aria-label={`Install ${name}`}>
            {installed ? "Install again" : "Install"}
          </Button>
        ) : (
          !installed && <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">Ask an admin to install</span>
        )}
      </div>
    </li>
  );
}

/** Props for {@link UploadTile}. */
export interface UploadTileProps {
  readonly onUpload: () => void;
  readonly className?: string;
}

export function UploadTile({ onUpload, className }: UploadTileProps) {
  return (
    <li className={cn("stg:flex", className)}>
      <button
        type="button"
        onClick={onUpload}
        className={cn(cardClasses({ placeholder: true, interactive: true }), CARD_LAYOUT, "stg:h-full stg:w-full stg:items-start")}
      >
        <span className="stg:flex stg:size-10 stg:items-center stg:justify-center stg:rounded-lg stg:border stg:border-dashed stg:border-border stg:text-muted-foreground">
          <UploadIcon className="stg:size-5" />
        </span>
        <span className="stg:text-sm stg:font-semibold stg:text-foreground">Upload a plugin</span>
        <span className="stg:text-xs stg:text-muted-foreground">
          A Cursor, Claude Code, Codex or Agent Plugins folder from your computer, or a .zip of one.
        </span>
      </button>
    </li>
  );
}
