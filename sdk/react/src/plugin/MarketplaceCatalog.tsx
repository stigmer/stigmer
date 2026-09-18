"use client";

/**
 * The Marketplace: where a user finds and installs plugins.
 *
 * The sources come first: one chip per source (`SourceChips`), each with
 * the publisher's mark, its name and its entry count, "All sources"
 * selected by default, Manage sources beside them. Then one search box and
 * ONE grid of cards across the selected sources, 24 to a page, in listing
 * order (the official catalogue, then the vendors as the product names
 * them, then the sources the user added), each source keeping its own
 * curation order. A card wears the plugin's own face (`PluginCard`), says
 * where it comes from, and opens the install preview the CLI prints; the
 * first tile on the first page is Upload a plugin, the same shape, opening
 * the uploader in a dialog on this page.
 *
 * Every source is read independently through `useMarketplaceCatalog` (one
 * store, one read per source), so the first cards paint when the first
 * catalogue lands, a catalogue that cannot be read is its own chip's
 * warning and, when that chip is chosen, one sentence with a retry, and
 * the page never waits for its slowest source. A catalogue that arrives
 * late appends after the ones already shown; nothing reorders.
 *
 * "Installed" on a card is a slug match against the organization's
 * plugins; the exact-version fact ("already installed", "upgrade") belongs
 * to the install dialog, where the archive exists to compare.
 */

import { useCallback, useId, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { MarketplaceEntry, MarketplaceFinding } from "@stigmer/plugin-package";

import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { DialogShell } from "../internal/DialogShell.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { INPUT_CLASSES } from "../internal/form-primitives.js";
import { Pagination } from "../internal/Pagination.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { ManageSourcesDialog } from "./ManageSourcesDialog.js";
import { PluginCard, UploadTile } from "./PluginCard.js";
import { PluginInstallDialog } from "./PluginInstallDialog.js";
import { PluginUploader } from "./PluginUploader.js";
import { SourceChips } from "./SourceChips.js";
import type { SourceRead } from "./catalog-store.js";
import type { FetchImpl } from "./sources/types.js";
import type { InstallPluginOutcome } from "./useInstallPlugin.js";
import { type CatalogEntry, catalogEntries, useMarketplaceCatalog } from "./useMarketplaceCatalog.js";
import { useMarketplaces } from "./useMarketplaces.js";
import { usePluginList } from "./usePluginList.js";

/** Props for {@link MarketplaceCatalog}. */
export interface MarketplaceCatalogProps {
  /** The organization plugins are installed into, and whose installed plugins mark the cards. */
  readonly org: string;
  /** Called after a plugin is installed, from a card or from the Upload tile; the host navigates to its page. */
  readonly onInstalled?: (outcome: InstallPluginOutcome) => void;
  /** The HTTP client the sources are read through; `globalThis.fetch` when absent. Tests inject a fake. */
  readonly fetchImpl?: FetchImpl;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/** Cards per page: three columns by eight rows at the widest layout, so a page is one screen and a half. */
export const CATALOG_PAGE_SIZE = 24;

/** The most installed plugins a card lookup reads; an org with more is a scale the search box already serves. */
const INSTALLED_LOOKUP_PAGE_SIZE = 200;

/**
 * Browse every known source and install a plugin from any of them, or upload one.
 *
 * @example
 * ```tsx
 * <MarketplaceCatalog
 *   org={org}
 *   onInstalled={({ plugin }) => navigateToDetail("plugins", org, plugin.metadata.slug)}
 * />
 * ```
 */
export function MarketplaceCatalog({ org, onInstalled, fetchImpl, className }: MarketplaceCatalogProps) {
  const sources = useMarketplaces(fetchImpl ? { fetchImpl } : {});
  const { reads, refetch } = useMarketplaceCatalog(sources.marketplaces, fetchImpl ? { fetchImpl } : {});
  const installed = usePluginList(org, { pageSize: INSTALLED_LOOKUP_PAGE_SIZE });
  const installedSlugs = useMemo(() => new Set(installed.plugins.map((plugin) => plugin.slug)), [installed.plugins]);

  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pageNum, setPageNum] = useState(1);
  const [installing, setInstalling] = useState<CatalogEntry | null>(null);
  const [uploading, setUploading] = useState(false);
  const [managing, setManaging] = useState(false);
  const searchId = useId();

  // A choice of source or a new query starts at the first page; both are user acts, so the reset is theirs, not an effect's.
  const selectSource = useCallback((name: string | null) => {
    setSelectedSource(name);
    setPageNum(1);
  }, []);
  const changeQuery = useCallback((next: string) => {
    setQuery(next);
    setPageNum(1);
  }, []);

  // A selected source that was removed from the list falls back to every source.
  const selected = selectedSource !== null && reads.some((read) => read.marketplace.name === selectedSource) ? selectedSource : null;
  const shownReads = useMemo(() => (selected === null ? reads : reads.filter((read) => read.marketplace.name === selected)), [reads, selected]);
  const entries = useMemo(() => catalogEntries(shownReads), [shownReads]);
  const matching = useMemo(() => entries.filter((catalogEntry) => matchesQuery(catalogEntry.entry, query)), [entries, query]);

  const searching = query.trim() !== "";
  const showUploadTile = !searching;
  // The Upload tile takes one slot on the first page, so the first page holds one card fewer.
  const totalSlots = matching.length + (showUploadTile ? 1 : 0);
  const totalPages = Math.max(1, Math.ceil(totalSlots / CATALOG_PAGE_SIZE));
  const page = Math.min(pageNum, totalPages);
  const firstSlot = (page - 1) * CATALOG_PAGE_SIZE;
  const offset = showUploadTile ? 1 : 0;
  const pageEntries = matching.slice(Math.max(0, firstSlot - offset), firstSlot - offset + CATALOG_PAGE_SIZE);

  const anyReading = shownReads.some((read) => read.state.kind === "reading");
  const failed = shownReads.filter((read) => read.state.kind === "failed");

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-6", className)}>
      <SourceChips reads={reads} selected={selected} onSelect={selectSource} onManage={() => setManaging(true)} />

      <div className="stg:flex stg:flex-col stg:gap-1.5">
        <label htmlFor={searchId} className="stg:text-sm stg:font-medium stg:text-foreground">
          Search plugins
        </label>
        <input
          id={searchId}
          type="search"
          className={INPUT_CLASSES}
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          placeholder={selected === null ? "Search every source by name or description…" : `Search ${selected} by name or description…`}
        />
      </div>

      {failed.length > 0 && <FailedSources failed={failed} refetch={refetch} whole={selected !== null} />}

      {anyReading && entries.length === 0 && (
        <div className="stg:flex stg:items-center stg:gap-2 stg:text-sm stg:text-muted-foreground" role="status">
          <SpinnerIcon className="stg:size-4" />
          Reading {selected ?? "the sources"}…
        </div>
      )}

      {entries.length > 0 && matching.length === 0 && searching && (
        <p className="stg:text-sm stg:text-muted-foreground">Nothing here matches '{query.trim()}'.</p>
      )}
      {!anyReading && failed.length === 0 && entries.length === 0 && (
        <p className="stg:text-sm stg:text-muted-foreground">
          {selected === null ? "No source offers a plugin this console can install." : `${selected} offers no plugins this console can install.`}
        </p>
      )}

      {(pageEntries.length > 0 || (showUploadTile && page === 1)) && (
        <ul className={cn(UNSTYLED_LIST, "stg:grid stg:gap-3 stg:sm:grid-cols-2 stg:lg:grid-cols-3")} aria-label="Plugins">
          {showUploadTile && page === 1 && <UploadTile onUpload={() => setUploading(true)} />}
          {pageEntries.map((catalogEntry) => (
            <PluginCard
              key={`${catalogEntry.source.name}/${catalogEntry.entry.name}`}
              entry={catalogEntry}
              installed={installedSlugs.has(catalogEntry.entry.name)}
              onInstall={setInstalling}
            />
          ))}
        </ul>
      )}

      {totalPages > 1 && <Pagination pageNum={page} totalPages={totalPages} onPageChange={setPageNum} ariaLabel="Plugins pagination" />}

      <DroppedEntries reads={shownReads} />

      <PluginInstallDialog
        opened={installing?.opened ?? null}
        entryName={installing?.entry.name ?? null}
        sourceName={installing?.source.name ?? ""}
        org={org}
        open={installing !== null}
        onClose={() => setInstalling(null)}
        onInstalled={(outcome) => {
          setInstalling(null);
          onInstalled?.(outcome);
        }}
      />

      <UploadDialog
        open={uploading}
        org={org}
        onClose={() => setUploading(false)}
        onInstalled={(outcome) => {
          setUploading(false);
          onInstalled?.(outcome);
        }}
      />

      <ManageSourcesDialog
        open={managing}
        onClose={() => setManaging(false)}
        marketplaces={sources.marketplaces}
        unreadable={sources.unreadable}
        isBuiltIn={sources.isBuiltIn}
        add={sources.add}
        remove={sources.remove}
      />
    </div>
  );
}

/** Whether `entry`'s name or description contains `query`, case-insensitively; everything matches an empty query. */
export function matchesQuery(entry: MarketplaceEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return entry.name.toLowerCase().includes(needle) || (entry.description?.toLowerCase().includes(needle) ?? false);
}

/** The entries whose name or description contains `query`, case-insensitively; every entry for an empty query. */
export function filterEntries(entries: readonly MarketplaceEntry[], query: string): readonly MarketplaceEntry[] {
  if (query.trim() === "") return entries;
  return entries.filter((entry) => matchesQuery(entry, query));
}

// ---------------------------------------------------------------------------
// The sources that could not be read: one sentence each, with a retry
// ---------------------------------------------------------------------------

function FailedSources({
  failed,
  refetch,
  whole,
}: {
  readonly failed: readonly SourceRead[];
  readonly refetch: (name: string) => void;
  /** When one source is chosen its refusal is the page's whole body; among many it is one line. */
  readonly whole: boolean;
}) {
  if (whole) {
    const [read] = failed;
    if (read === undefined || read.state.kind !== "failed") return null;
    return <ErrorMessage error={read.state.error} retry={() => refetch(read.marketplace.name)} title={`${read.marketplace.name} cannot be read right now`} />;
  }
  return (
    <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-1")} aria-label="Sources that cannot be read">
      {failed.map((read) =>
        read.state.kind === "failed" ? (
          <li key={read.marketplace.name} className="stg:flex stg:flex-wrap stg:items-baseline stg:gap-x-2 stg:text-xs stg:text-muted-foreground">
            <span className="stg:font-medium stg:text-foreground">{read.marketplace.name}</span>
            <span>cannot be read right now: {read.state.error.message}</span>
            <Button variant="ghost" size="xs" onClick={() => refetch(read.marketplace.name)} aria-label={`Retry ${read.marketplace.name}`}>
              Retry
            </Button>
          </li>
        ) : null,
      )}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Entries a catalogue lists that this console cannot install, per source
// ---------------------------------------------------------------------------

function DroppedEntries({ reads }: { readonly reads: readonly SourceRead[] }) {
  const dropped = reads.flatMap((read) =>
    read.state.kind === "ready" && read.state.opened.warnings.length > 0 ? [{ name: read.marketplace.name, warnings: read.state.opened.warnings }] : [],
  );
  if (dropped.length === 0) return null;
  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      {dropped.map(({ name, warnings }) => (
        <details key={name} className="stg:text-sm">
          <summary className="stg:cursor-pointer stg:text-muted-foreground">
            {warnings.length === 1 ? `1 entry from ${name} cannot be installed` : `${warnings.length} entries from ${name} cannot be installed`}
          </summary>
          <ul className="stg:mt-2 stg:list-disc stg:space-y-1 stg:pl-5 stg:text-muted-foreground">
            {warnings.map((warning: MarketplaceFinding, index) => (
              <li key={`${warning.kind}:${index}`}>{warning.message}</li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload a plugin, in a dialog on this page: the console's `stigmer push plugin`
// ---------------------------------------------------------------------------

function UploadDialog({
  open,
  org,
  onClose,
  onInstalled,
}: {
  readonly open: boolean;
  readonly org: string;
  readonly onClose: () => void;
  readonly onInstalled: (outcome: InstallPluginOutcome) => void;
}) {
  const titleId = useId();
  return (
    <DialogShell
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      width="lg"
      className="stg:max-h-[85vh] stg:bg-card stg:text-foreground"
      aria-labelledby={titleId}
    >
      {open && (
        <div className="stg:flex stg:max-h-[85vh] stg:flex-col stg:gap-4 stg:overflow-y-auto stg:p-6">
          <h2 id={titleId} className="stg:text-base stg:font-semibold stg:text-foreground">
            Upload a plugin
          </h2>
          <PluginUploader org={org} onComplete={onInstalled} onCancel={onClose} />
        </div>
      )}
    </DialogShell>
  );
}
