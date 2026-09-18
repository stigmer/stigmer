"use client";

/**
 * The Marketplace: where a user finds and installs plugins.
 *
 * One page, one search box, the plugins on offer in a section per source
 * (the official catalogue first, then the vendors' built-in catalogues,
 * then the sources the user added), Install on each card. A card says
 * "Installed" when the organization already holds a plugin of that name;
 * the exact-version fact ("already installed", "upgrade") belongs to the
 * install dialog, where the archive exists to compare.
 *
 * Every section reads its own source (`useMarketplace`), so a catalogue
 * that cannot be read says so in its own section and the page stands; the
 * official one is immutable and CDN-cached and is the section that always
 * shows once the server reports a release. Sections load independently
 * because a hook per section is how React expresses independent reads; a
 * page-level hook over every source would make the first paint wait for
 * the slowest catalogue.
 *
 * Source configuration is an advanced disclosure at the bottom
 * (`SourcesPanel`): the built-ins listed as such, the added ones with
 * Remove, and the form to add one. The CLI's four acts have their twins
 * there (`marketplace list`, `add`, `remove`) and in each section (`show`),
 * but the page a user opens is about plugins, not about where they come
 * from.
 */

import { useId, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { MarketplaceEntry, MarketplaceFinding } from "@stigmer/plugin-package";
import { BUILT_IN_MARKETPLACES, GITHUB_SOURCE_SHAPE, describeGitHubSource } from "@stigmer/plugin-package/client";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { Field, INPUT_CLASSES } from "../internal/form-primitives.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { PluginInstallDialog } from "./PluginInstallDialog.js";
import type { OpenedMarketplace } from "./sources/read.js";
import type { FetchImpl, KnownMarketplace, MarketplaceSource } from "./sources/types.js";
import type { InstallPluginOutcome } from "./useInstallPlugin.js";
import { useMarketplace } from "./useMarketplace.js";
import { type AddSourceOutcome, type UnreadableMarketplace, useMarketplaces } from "./useMarketplaces.js";
import { usePluginList } from "./usePluginList.js";

/** Props for {@link MarketplaceCatalog}. */
export interface MarketplaceCatalogProps {
  /** The organization plugins are installed into, and whose installed plugins mark the cards. */
  readonly org: string;
  /** Called after a plugin is installed; the host navigates to its page. */
  readonly onInstalled?: (outcome: InstallPluginOutcome) => void;
  /** The HTTP client the sources are read through; `globalThis.fetch` when absent. Tests inject a fake. */
  readonly fetchImpl?: FetchImpl;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/** The most installed plugins a card lookup reads; an org with more is a scale the search box already serves. */
const INSTALLED_LOOKUP_PAGE_SIZE = 200;

/**
 * Browse every known source and install a plugin from any of them.
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
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{
    readonly source: KnownMarketplace;
    readonly opened: OpenedMarketplace;
    readonly entryName: string;
  } | null>(null);
  const searchId = useId();

  const installed = usePluginList(org, { pageSize: INSTALLED_LOOKUP_PAGE_SIZE });
  const installedSlugs = useMemo(() => new Set(installed.plugins.map((plugin) => plugin.slug)), [installed.plugins]);

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-8", className)}>
      <div className="stg:flex stg:flex-col stg:gap-1.5">
        <label htmlFor={searchId} className="stg:text-sm stg:font-medium stg:text-foreground">
          Search plugins
        </label>
        <input
          id={searchId}
          type="search"
          className={INPUT_CLASSES}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search every source by name or description…"
        />
      </div>

      <div className="stg:flex stg:flex-col stg:gap-8" aria-label="Sources">
        {sources.marketplaces.map((marketplace) => (
          <SourceSection
            key={marketplace.name}
            marketplace={marketplace}
            query={query}
            installedSlugs={installedSlugs}
            fetchImpl={fetchImpl}
            onInstall={(opened, entryName) => setSelected({ source: marketplace, opened, entryName })}
          />
        ))}
      </div>

      <SourcesPanel
        marketplaces={sources.marketplaces}
        unreadable={sources.unreadable}
        isBuiltIn={sources.isBuiltIn}
        add={sources.add}
        remove={sources.remove}
      />

      <PluginInstallDialog
        opened={selected?.opened ?? null}
        entryName={selected?.entryName ?? null}
        sourceName={selected?.source.name ?? ""}
        org={org}
        open={selected !== null}
        onClose={() => setSelected(null)}
        onInstalled={(outcome) => {
          setSelected(null);
          onInstalled?.(outcome);
        }}
      />
    </div>
  );
}

/** The entries whose name or description contains `query`, case-insensitively; every entry for an empty query. */
export function filterEntries(entries: readonly MarketplaceEntry[], query: string): readonly MarketplaceEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return entries;
  return entries.filter(
    (entry) => entry.name.toLowerCase().includes(needle) || (entry.description?.toLowerCase().includes(needle) ?? false),
  );
}

// ---------------------------------------------------------------------------
// One source's section: `marketplace show`, with Install on each card
// ---------------------------------------------------------------------------

function SourceSection({
  marketplace,
  query,
  installedSlugs,
  fetchImpl,
  onInstall,
}: {
  readonly marketplace: KnownMarketplace;
  readonly query: string;
  readonly installedSlugs: ReadonlySet<string>;
  readonly fetchImpl: FetchImpl | undefined;
  readonly onInstall: (opened: OpenedMarketplace, entryName: string) => void;
}) {
  const read = useMarketplace(marketplace.source, fetchImpl ? { fetchImpl } : {});
  const builtIn = BUILT_IN_MARKETPLACES.find((entry) => entry.name === marketplace.name);
  const description = builtIn?.description ?? read.marketplace?.description;
  const shown = read.marketplace ? filterEntries(read.marketplace.plugins, query) : [];
  const headingId = `${useId()}-heading`;

  return (
    <details open className="stg:group" aria-labelledby={headingId}>
      <summary className="stg:flex stg:cursor-pointer stg:list-none stg:items-baseline stg:justify-between stg:gap-4 stg:border-b stg:border-border stg:pb-2">
        <div className="stg:min-w-0">
          <h2 id={headingId} className="stg:text-base stg:font-semibold stg:text-foreground">
            {marketplace.name}
          </h2>
          {description && <p className="stg:mt-0.5 stg:text-sm stg:text-muted-foreground">{description}</p>}
        </div>
        <p className="stg:shrink-0 stg:font-mono stg:text-xs stg:text-muted-foreground">{describeSource(marketplace.source)}</p>
      </summary>

      <div className="stg:pt-4">
        {read.isLoading && (
          <div className="stg:flex stg:items-center stg:gap-2 stg:text-sm stg:text-muted-foreground" role="status">
            <SpinnerIcon className="stg:size-4" />
            Reading {marketplace.name}…
          </div>
        )}

        {read.error && <ErrorMessage error={read.error} retry={read.refetch} title={`${marketplace.name} cannot be read right now`} />}

        {read.marketplace && (
          <>
            {read.marketplace.plugins.length === 0 ? (
              <p className="stg:text-sm stg:text-muted-foreground">It offers no plugins this console can install.</p>
            ) : shown.length === 0 ? (
              <p className="stg:text-sm stg:text-muted-foreground">Nothing here matches '{query.trim()}'.</p>
            ) : (
              <ul className={cn(UNSTYLED_LIST, "stg:grid stg:gap-3 stg:sm:grid-cols-2 stg:lg:grid-cols-3")} aria-label={`Plugins from ${marketplace.name}`}>
                {shown.map((entry) => (
                  <EntryCard
                    key={entry.name}
                    entry={entry}
                    installed={installedSlugs.has(entry.name)}
                    onInstall={() => {
                      if (read.opened) onInstall(read.opened, entry.name);
                    }}
                  />
                ))}
              </ul>
            )}
            {read.warnings.length > 0 && <DroppedEntries warnings={read.warnings} />}
          </>
        )}
      </div>
    </details>
  );
}

function EntryCard({
  entry,
  installed,
  onInstall,
}: {
  readonly entry: MarketplaceEntry;
  readonly installed: boolean;
  readonly onInstall: () => void;
}) {
  return (
    <li className="stg:flex stg:flex-col stg:justify-between stg:gap-3 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4">
      <div className="stg:min-w-0">
        <div className="stg:flex stg:items-center stg:justify-between stg:gap-2">
          <p className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">{entry.name}</p>
          {installed && (
            <span className="stg:shrink-0 stg:rounded-full stg:border stg:border-border stg:bg-muted stg:px-2 stg:py-0.5 stg:text-xs stg:text-muted-foreground">
              Installed
            </span>
          )}
        </div>
        {entry.description && <p className="stg:mt-1 stg:line-clamp-3 stg:text-xs stg:text-muted-foreground">{entry.description}</p>}
      </div>
      <Button variant="outline" size="sm" onClick={onInstall} aria-label={`Install ${entry.name}`} className="stg:self-start">
        {installed ? "Install again" : "Install"}
      </Button>
    </li>
  );
}

function DroppedEntries({ warnings }: { readonly warnings: readonly MarketplaceFinding[] }) {
  return (
    <details className="stg:mt-3 stg:text-sm">
      <summary className="stg:cursor-pointer stg:text-muted-foreground">
        {warnings.length === 1 ? "1 entry cannot be installed" : `${warnings.length} entries cannot be installed`}
      </summary>
      <ul className="stg:mt-2 stg:list-disc stg:space-y-1 stg:pl-5 stg:text-muted-foreground">
        {warnings.map((warning, index) => (
          <li key={`${warning.kind}:${index}`}>{warning.message}</li>
        ))}
      </ul>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Sources: `marketplace list`, `add`, `remove`, behind a disclosure
// ---------------------------------------------------------------------------

function SourcesPanel({
  marketplaces,
  unreadable,
  isBuiltIn,
  add,
  remove,
}: {
  readonly marketplaces: readonly KnownMarketplace[];
  readonly unreadable: readonly UnreadableMarketplace[];
  readonly isBuiltIn: (name: string) => boolean;
  readonly add: (sourceText: string, name?: string) => Promise<AddSourceOutcome>;
  readonly remove: (name: string) => string | null;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <details className="stg:rounded-lg stg:border stg:border-border stg:p-4" aria-label="Sources">
      <summary className="stg:cursor-pointer stg:text-sm stg:font-medium stg:text-foreground">
        Sources ({marketplaces.length})
      </summary>
      <div className="stg:mt-4 stg:flex stg:flex-col stg:gap-4">
        <p className="stg:text-xs stg:text-muted-foreground">
          What the Marketplace shows comes from these catalogues. The built-in ones are the same in every Stigmer client;
          the ones you add are remembered in this browser, as the CLI remembers its own.
        </p>
        <ul className={cn(UNSTYLED_LIST, "stg:divide-y stg:divide-border stg:rounded-md stg:border stg:border-border")} aria-label="Known sources">
          {marketplaces.map((marketplace) => (
            <li key={marketplace.name} className="stg:flex stg:items-center stg:justify-between stg:gap-4 stg:px-3 stg:py-2">
              <div className="stg:min-w-0">
                <p className="stg:text-sm stg:text-foreground">{marketplace.name}</p>
                <p className="stg:font-mono stg:text-xs stg:text-muted-foreground">
                  {describeSource(marketplace.source)}
                  {isBuiltIn(marketplace.name) && marketplace.source.type !== "official" ? " (built in)" : ""}
                </p>
              </div>
              {!isBuiltIn(marketplace.name) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRefusal(remove(marketplace.name))}
                  aria-label={`Remove source ${marketplace.name}`}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
          {unreadable.map((entry) => (
            <li key={entry.name} className="stg:flex stg:items-center stg:justify-between stg:gap-4 stg:px-3 stg:py-2" role="alert">
              <div className="stg:min-w-0">
                <p className="stg:text-sm stg:text-foreground">{entry.name}</p>
                <p className="stg:text-xs stg:text-destructive">cannot be read: {entry.reason}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setRefusal(remove(entry.name))} aria-label={`Forget source ${entry.name}`}>
                Forget
              </Button>
            </li>
          ))}
        </ul>
        {refusal && (
          <p role="alert" className="stg:text-xs stg:text-destructive">
            {refusal}
          </p>
        )}
        <AddSourceForm add={add} />
      </div>
    </details>
  );
}

function AddSourceForm({ add }: { readonly add: (sourceText: string, name?: string) => Promise<AddSourceOutcome> }) {
  const [source, setSource] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ readonly kind: "refusal" | "added"; readonly text: string } | null>(null);
  const hintId = `${useId()}-source-hint`;

  return (
    <form
      className="stg:flex stg:flex-col stg:gap-2"
      aria-label="Add a source"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setMessage(null);
        void add(source, name).then((outcome) => {
          setBusy(false);
          if (outcome.ok) {
            setSource("");
            setName("");
            setMessage({ kind: "added", text: `Added source '${outcome.name}'.` });
          } else {
            setMessage({ kind: "refusal", text: outcome.message });
          }
        });
      }}
    >
      <div className="stg:flex stg:flex-col stg:gap-2 stg:sm:flex-row stg:sm:items-end">
        <Field label="GitHub repository" className="stg:flex-1">
          <input
            className={INPUT_CLASSES}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="owner/repo or https://github.com/owner/repo"
            aria-describedby={hintId}
          />
        </Field>
        <Field label="Name (optional)" className="stg:sm:w-48">
          <input
            className={INPUT_CLASSES}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="the catalogue's own name"
          />
        </Field>
        <Button type="submit" variant="outline" size="sm" disabled={busy || source.trim() === ""}>
          {busy ? "Reading…" : "Add source"}
        </Button>
      </div>
      <p id={hintId} className="stg:text-xs stg:text-muted-foreground">
        A source is {GITHUB_SOURCE_SHAPE}. It is read before it is added, and takes the name its marketplace file gives
        itself unless you choose one.
      </p>
      {message && (
        <p role={message.kind === "refusal" ? "alert" : "status"} className={cn("stg:text-xs", message.kind === "refusal" ? "stg:text-destructive" : "stg:text-muted-foreground")}>
          {message.text}
        </p>
      )}
    </form>
  );
}

function describeSource(source: MarketplaceSource): string {
  switch (source.type) {
    case "official":
      return "built in";
    case "github":
      return describeGitHubSource(source);
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}
