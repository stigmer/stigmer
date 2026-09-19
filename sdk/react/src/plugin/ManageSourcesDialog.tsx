"use client";

/**
 * Manage sources: the catalogues the Marketplace reads, in a dialog opened
 * from the sources row. The built-ins listed as such (they are code in
 * every Stigmer client and cannot be removed), the sources this browser
 * remembers with Remove, the ones it cannot read with Forget, and the form
 * that adds one. The CLI's `marketplace list`, `add` and `remove` have
 * their twins here; the page itself stays about plugins.
 *
 * Each row also says what its catalogue came to: how many plugins it
 * offers and how many it lists that this console cannot install, with the
 * reader's own sentences behind a disclosure (`marketplace show`'s words).
 * That fact lives here and not under the grid because nobody browsing a
 * storefront can act on a vendor's marketplace file; the person who can,
 * or who wonders where a plugin went, opens this dialog.
 *
 * A form dialog: no light dismiss on the backdrop, so a stray click never
 * discards a half-typed repository.
 */

import { useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { GITHUB_SOURCE_SHAPE, describeGitHubSource } from "@stigmer/plugin-package/client";

import { Button } from "../button/Button.js";
import { DialogShell } from "../internal/DialogShell.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { Field, INPUT_CLASSES } from "../internal/form-primitives.js";
import { SourceMark } from "./SourceMark.js";
import type { SourceRead } from "./catalog-store.js";
import type { KnownMarketplace, MarketplaceSource } from "./sources/types.js";
import type { AddSourceOutcome, UnreadableMarketplace } from "./useMarketplaces.js";

/** Props for {@link ManageSourcesDialog}. */
export interface ManageSourcesDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The catalogue reads, so each row can say what its source came to; a source without a read shows its identity alone. */
  readonly reads?: readonly SourceRead[];
  readonly marketplaces: readonly KnownMarketplace[];
  readonly unreadable: readonly UnreadableMarketplace[];
  readonly isBuiltIn: (name: string) => boolean;
  readonly add: (sourceText: string, name?: string) => Promise<AddSourceOutcome>;
  readonly remove: (name: string) => string | null;
}

const NO_READS: readonly SourceRead[] = [];

export function ManageSourcesDialog({ open, onClose, reads = NO_READS, marketplaces, unreadable, isBuiltIn, add, remove }: ManageSourcesDialogProps) {
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
          <header>
            <h2 id={titleId} className="stg:text-base stg:font-semibold stg:text-foreground">
              Sources
            </h2>
            <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
              What the Marketplace shows comes from these catalogues. The built-in ones are the same in every Stigmer
              client; the ones you add are remembered in this browser, as the CLI remembers its own.
            </p>
          </header>
          <SourceList reads={reads} marketplaces={marketplaces} unreadable={unreadable} isBuiltIn={isBuiltIn} remove={remove} />
          <AddSourceForm add={add} />
          <footer className="stg:flex stg:justify-end stg:pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </footer>
        </div>
      )}
    </DialogShell>
  );
}

function SourceList({
  reads,
  marketplaces,
  unreadable,
  isBuiltIn,
  remove,
}: {
  readonly reads: readonly SourceRead[];
  readonly marketplaces: readonly KnownMarketplace[];
  readonly unreadable: readonly UnreadableMarketplace[];
  readonly isBuiltIn: (name: string) => boolean;
  readonly remove: (name: string) => string | null;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      <ul className={cn(UNSTYLED_LIST, "stg:divide-y stg:divide-border stg:rounded-md stg:border stg:border-border")} aria-label="Known sources">
        {marketplaces.map((marketplace) => (
          <li key={marketplace.name} className="stg:flex stg:flex-col stg:gap-2 stg:px-3 stg:py-2">
            <div className="stg:flex stg:items-center stg:justify-between stg:gap-4">
              <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-3">
                <SourceMark source={marketplace.source} size="md" />
                <div className="stg:min-w-0">
                  <p className="stg:text-sm stg:text-foreground">{marketplace.name}</p>
                  <p className="stg:font-mono stg:text-xs stg:text-muted-foreground">
                    {describeSource(marketplace.source)}
                    {isBuiltIn(marketplace.name) && marketplace.source.type !== "official" ? " (built in)" : ""}
                  </p>
                </div>
              </div>
              {!isBuiltIn(marketplace.name) && (
                <Button variant="ghost" size="sm" onClick={() => setRefusal(remove(marketplace.name))} aria-label={`Remove source ${marketplace.name}`}>
                  Remove
                </Button>
              )}
            </div>
            <SourceOutcome read={reads.find((candidate) => candidate.marketplace.name === marketplace.name)} />
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
    </div>
  );
}

/**
 * What a source's catalogue came to, in one line under its row: the count
 * it offers and, when the reader dropped entries, how many and why (the
 * reader's sentences, behind a disclosure). A source still reading or one
 * that failed says so in the same place, in the failure's own words.
 */
function SourceOutcome({ read }: { readonly read: SourceRead | undefined }) {
  if (read === undefined) return null;
  const { state } = read;
  switch (state.kind) {
    case "reading":
      return <p className="stg:text-xs stg:text-muted-foreground">Reading…</p>;
    case "failed":
      return <p className="stg:text-xs stg:text-destructive">cannot be read: {state.error.message}</p>;
    case "ready": {
      const offered = state.opened.marketplace.plugins.length;
      const dropped = state.opened.warnings;
      const offers = offered === 1 ? "Offers 1 plugin" : `Offers ${offered} plugins`;
      if (dropped.length === 0) return <p className="stg:text-xs stg:text-muted-foreground">{offers}.</p>;
      return (
        <details className="stg:text-xs stg:text-muted-foreground">
          <summary className="stg:cursor-pointer">
            {offers}; {dropped.length === 1 ? "1 entry it lists" : `${dropped.length} entries it lists`} cannot be installed from here.
          </summary>
          <ul className="stg:mt-1 stg:list-disc stg:space-y-1 stg:pl-5">
            {dropped.map((warning, index) => (
              <li key={`${warning.kind}:${index}`}>{warning.message}</li>
            ))}
          </ul>
        </details>
      );
    }
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
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
          <input className={INPUT_CLASSES} value={name} onChange={(event) => setName(event.target.value)} placeholder="the catalogue's own name" />
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

/** How a source is named in a list row: "built in" for the official catalogue, the repository for a GitHub one. */
export function describeSource(source: MarketplaceSource): string {
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
