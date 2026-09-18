/**
 * The Marketplace's catalogue reads, one per source, held together so that
 * one grid can be drawn across them.
 *
 * A page that shows N sources as one list needs N independent reads in one
 * place. A hook per source cannot do it (React calls a fixed number of
 * hooks per render), and one `Promise.all` would make the first card wait
 * for the slowest catalogue. So the reads live in a store in the SDK's
 * external-store shape (`internal/store/`: `subscribe`, `getSnapshot`,
 * consumed through `useSyncExternalStore`): each source is read on its
 * own, a failure is that source's alone, and a chip and a card read one
 * snapshot.
 *
 * The snapshot is an array in the sources' listing order whose elements
 * are replaced only when their own state changes, so a consumer's
 * `useMemo` over it re-runs when a catalogue arrives and not when a
 * sibling's spinner ticks. A read that finishes after its source was
 * removed or replaced is dropped by generation, never written over the
 * newer state.
 */

import { toError } from "../internal/toError.js";
import type { OpenedMarketplace } from "./sources/read.js";
import type { KnownMarketplace, MarketplaceSource } from "./sources/types.js";

/** Where one source's read stands. */
export type SourceReadState =
  | { readonly kind: "reading" }
  | { readonly kind: "ready"; readonly opened: OpenedMarketplace }
  | { readonly kind: "failed"; readonly error: Error };

/** One source and its read. */
export interface SourceRead {
  readonly marketplace: KnownMarketplace;
  readonly state: SourceReadState;
}

/** Opens a source; the store is agnostic of how (the hook binds the client and the fetch). */
export type OpenSource = (source: MarketplaceSource) => Promise<OpenedMarketplace>;

/** One string per source identity, so a re-added name with another repository reads again. */
export function sourceKeyOf(source: MarketplaceSource): string {
  switch (source.type) {
    case "official":
      return "official";
    case "github":
      return `github:${source.repo}@${source.ref ?? ""}`;
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

const READING: SourceReadState = { kind: "reading" };

export class MarketplaceCatalogStore {
  private readonly reads = new Map<string, SourceRead>();
  private readonly keys = new Map<string, string>();
  private readonly generations = new Map<string, number>();
  private order: readonly string[] = [];
  private snapshot: readonly SourceRead[] = [];
  private readonly listeners = new Set<() => void>();
  private open: OpenSource | null = null;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): readonly SourceRead[] => this.snapshot;

  /**
   * Make the store's sources `marketplaces`, in that order: a new or
   * changed source starts reading, a removed one is forgotten, an unchanged
   * one keeps its state. `open` is what a new read and a refetch call.
   */
  sync(marketplaces: readonly KnownMarketplace[], open: OpenSource): void {
    this.open = open;
    const names = new Set(marketplaces.map((entry) => entry.name));
    for (const name of [...this.reads.keys()]) {
      if (!names.has(name)) this.forget(name);
    }
    for (const marketplace of marketplaces) {
      const key = sourceKeyOf(marketplace.source);
      if (this.keys.get(marketplace.name) === key) continue;
      this.keys.set(marketplace.name, key);
      this.start(marketplace);
    }
    this.order = marketplaces.map((entry) => entry.name);
    this.publish();
  }

  /** Read `name` again; a no-op for a source the store does not hold. */
  refetch(name: string): void {
    const read = this.reads.get(name);
    if (read === undefined) return;
    this.start(read.marketplace);
    this.publish();
  }

  private start(marketplace: KnownMarketplace): void {
    const open = this.open;
    if (open === null) throw new Error("MarketplaceCatalogStore.sync must run before a read starts");
    const generation = (this.generations.get(marketplace.name) ?? 0) + 1;
    this.generations.set(marketplace.name, generation);
    this.reads.set(marketplace.name, { marketplace, state: READING });
    const settle = (state: SourceReadState): void => {
      // A read from before a refetch, a removal or a source change is stale.
      if (this.generations.get(marketplace.name) !== generation) return;
      this.reads.set(marketplace.name, { marketplace, state });
      this.publish();
    };
    open(marketplace.source).then(
      (opened) => settle({ kind: "ready", opened }),
      (error: unknown) => settle({ kind: "failed", error: toError(error) }),
    );
  }

  private forget(name: string): void {
    this.reads.delete(name);
    this.keys.delete(name);
    // Bumping the generation drops a read still in flight for the removed source.
    this.generations.set(name, (this.generations.get(name) ?? 0) + 1);
  }

  private publish(): void {
    const next: SourceRead[] = [];
    for (const name of this.order) {
      const read = this.reads.get(name);
      if (read !== undefined) next.push(read);
    }
    const unchanged = next.length === this.snapshot.length && next.every((read, index) => read === this.snapshot[index]);
    if (unchanged) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
