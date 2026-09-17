"use client";

/**
 * The marketplaces this browser knows and what each offers, with Install.
 *
 * The four CLI acts have one console twin each: the tab strip is
 * `marketplace list`, a tab's panel is `marketplace show` (installable
 * entries, then the entries the reader dropped with their sentences), the
 * form at the top is `marketplace add <source> --name`, the remove control
 * on a tab is `marketplace remove`, and an entry's Install opens the same
 * preview `stigmer install --dry-run` prints. The official marketplace is
 * first and cannot be removed. Selection is local state; the host passes
 * the organization and, through `onInstalled`, the route to the plugin's
 * page.
 */

import { useCallback, useId, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { MarketplaceEntry, MarketplaceFinding } from "@stigmer/plugin-package";
import { GITHUB_SOURCE_SHAPE, describeGitHubSource } from "@stigmer/plugin-package/client";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { Field, INPUT_CLASSES } from "../internal/form-primitives.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Tabs, type TabItem } from "../tabs/Tabs.js";
import { PluginInstallDialog } from "./PluginInstallDialog.js";
import type { KnownMarketplace, MarketplaceSource } from "./sources/types.js";
import type { InstallPluginOutcome } from "./useInstallPlugin.js";
import { type UseMarketplaceOptions, type UseMarketplaceReturn, useMarketplace } from "./useMarketplace.js";
import { OFFICIAL_MARKETPLACE_NAME, useMarketplaces } from "./useMarketplaces.js";

/** Props for {@link MarketplaceBrowser}. */
export interface MarketplaceBrowserProps {
  /** The organization plugins are installed into. */
  readonly org: string;
  /** Called after a plugin is installed; the host navigates to its page. */
  readonly onInstalled?: (outcome: InstallPluginOutcome) => void;
  /** The HTTP client the marketplace hosts are read through; `globalThis.fetch` when absent. */
  readonly fetchImpl?: UseMarketplaceOptions["fetchImpl"];
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Browse the known marketplaces and install a plugin from one.
 *
 * @example
 * ```tsx
 * <MarketplaceBrowser
 *   org={org}
 *   onInstalled={({ plugin }) => navigateToDetail("plugins", org, plugin.metadata.slug)}
 * />
 * ```
 */
export function MarketplaceBrowser({ org, onInstalled, fetchImpl, className }: MarketplaceBrowserProps) {
  const { marketplaces, unreadable, add, remove } = useMarketplaces();
  const [activeName, setActiveName] = useState<string>(OFFICIAL_MARKETPLACE_NAME);
  const active = marketplaces.find((m) => m.name === activeName) ?? marketplaces[0];
  const [selectedEntry, setSelectedEntry] = useState<string | null>(null);
  const read = useMarketplace(active?.source ?? null, fetchImpl ? { fetchImpl } : {});

  const tabs = useMemo<readonly TabItem[]>(() => marketplaces.map((m) => ({ id: m.name, label: m.name })), [marketplaces]);

  const handleRemove = useCallback(
    (name: string) => {
      const refusal = remove(name);
      if (refusal === null && activeName === name) setActiveName(OFFICIAL_MARKETPLACE_NAME);
      return refusal;
    },
    [remove, activeName],
  );

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-6", className)}>
      <AddMarketplaceForm
        onAdd={(name, source) => {
          const refusal = add(name, source);
          if (refusal === null) setActiveName(name);
          return refusal;
        }}
      />

      {unreadable.length > 0 && (
        <div role="alert" className="stg:rounded-md stg:border stg:border-border stg:p-3 stg:text-sm">
          <p className="stg:font-medium stg:text-foreground">Remembered but unreadable:</p>
          <ul className={cn(UNSTYLED_LIST, "stg:mt-1 stg:space-y-1")}>
            {unreadable.map((entry) => (
              <li key={entry.name} className="stg:flex stg:items-center stg:justify-between stg:gap-3 stg:text-muted-foreground">
                <span>
                  <span className="stg:font-medium stg:text-foreground">{entry.name}</span>: {entry.reason}
                </span>
                <Button variant="ghost" size="xs" onClick={() => remove(entry.name)}>
                  Forget
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {active && (
        <Tabs tabs={tabs} activeTab={active.name} onTabChange={setActiveName} aria-label="Marketplaces">
          <MarketplacePanel
            marketplace={active}
            read={read}
            onInstall={setSelectedEntry}
            onRemove={active.name === OFFICIAL_MARKETPLACE_NAME ? undefined : () => handleRemove(active.name)}
          />
        </Tabs>
      )}

      {active && (
        <PluginInstallDialog
          opened={read.opened}
          entryName={selectedEntry}
          marketplaceName={active.name}
          org={org}
          open={selectedEntry !== null}
          onClose={() => setSelectedEntry(null)}
          onInstalled={onInstalled}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One marketplace's panel: `marketplace show`
// ---------------------------------------------------------------------------

function MarketplacePanel({
  marketplace,
  read: { marketplace: read, warnings, isLoading, error, refetch },
  onInstall,
  onRemove,
}: {
  readonly marketplace: KnownMarketplace;
  readonly read: UseMarketplaceReturn;
  readonly onInstall: (entryName: string) => void;
  readonly onRemove?: () => string | null;
}) {

  return (
    <div className="stg:flex stg:flex-col stg:gap-4 stg:pt-4">
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-4">
        <div className="stg:min-w-0">
          <p className="stg:text-sm stg:text-foreground">
            {read?.description ?? (read ? `Marketplace '${read.name}'` : "")}
          </p>
          <p className="stg:mt-0.5 stg:font-mono stg:text-xs stg:text-muted-foreground">{describeSource(marketplace.source)}</p>
        </div>
        {onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            Remove marketplace
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="stg:flex stg:items-center stg:gap-2 stg:text-sm stg:text-muted-foreground" role="status">
          <SpinnerIcon className="stg:size-4" />
          Reading the marketplace…
        </div>
      )}

      {error && <ErrorMessage error={error} retry={refetch} title="This marketplace cannot be read" />}

      {read && (
        <>
          {read.plugins.length === 0 ? (
            <p className="stg:text-sm stg:text-muted-foreground">It offers no plugins this console can install.</p>
          ) : (
            <ul
              className={cn(UNSTYLED_LIST, "stg:divide-y stg:divide-border stg:overflow-hidden stg:rounded-lg stg:border stg:border-border")}
              aria-label="Plugins offered"
            >
              {read.plugins.map((entry) => (
                <EntryRow key={entry.name} entry={entry} onInstall={() => onInstall(entry.name)} />
              ))}
            </ul>
          )}
          {warnings.length > 0 && <DroppedEntries warnings={warnings} />}
        </>
      )}
    </div>
  );
}

function EntryRow({ entry, onInstall }: { readonly entry: MarketplaceEntry; readonly onInstall: () => void }) {
  return (
    <li className="stg:flex stg:items-center stg:justify-between stg:gap-4 stg:px-3 stg:py-2.5">
      <div className="stg:min-w-0">
        <p className="stg:text-sm stg:font-medium stg:text-foreground">{entry.name}</p>
        {entry.description && <p className="stg:mt-0.5 stg:line-clamp-2 stg:text-xs stg:text-muted-foreground">{entry.description}</p>}
      </div>
      <Button variant="outline" size="sm" onClick={onInstall} aria-label={`Install ${entry.name}`}>
        Install
      </Button>
    </li>
  );
}

function DroppedEntries({ warnings }: { readonly warnings: readonly MarketplaceFinding[] }) {
  return (
    <details className="stg:text-sm">
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
// `marketplace add <source> --name <name>`
// ---------------------------------------------------------------------------

function AddMarketplaceForm({ onAdd }: { readonly onAdd: (name: string, source: string) => string | null }) {
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const hintId = `${useId()}-source-hint`;

  return (
    <form
      className="stg:flex stg:flex-col stg:gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const outcome = onAdd(name.trim(), source);
        setRefusal(outcome);
        if (outcome === null) {
          setName("");
          setSource("");
        }
      }}
      aria-label="Add a marketplace"
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
        <Field label="Name" className="stg:sm:w-48">
          <input
            className={INPUT_CLASSES}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="cursor-plugins"
          />
        </Field>
        <Button type="submit" variant="outline" size="sm" disabled={name.trim() === "" || source.trim() === ""}>
          Add marketplace
        </Button>
      </div>
      <p id={hintId} className="stg:text-xs stg:text-muted-foreground">
        A source is {GITHUB_SOURCE_SHAPE}. It is remembered in this browser, as the CLI remembers its own.
      </p>
      {refusal && (
        <p role="alert" className="stg:text-xs stg:text-destructive">
          {refusal}
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
