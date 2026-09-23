/**
 * The catalogue store, without React. Pins: every source starts reading
 * at once and settles on its own, so a slow catalogue never delays a fast
 * one; a failure is that source's alone; the snapshot keeps the sources'
 * order and keeps an unchanged element's reference when a sibling
 * settles; a removed source is forgotten and a read of it that lands late
 * is dropped; a source re-added under the same name with another
 * repository reads again; `refetch` reads one source again and a stale
 * read from before it never overwrites the newer state.
 */

import { describe, expect, it } from "vitest";

import { MarketplaceCatalogStore, type OpenSource, sourceKeyOf } from "../catalog-store.js";
import type { OpenedMarketplace } from "../sources/read.js";
import type { KnownMarketplace, MarketplaceSource } from "../sources/types.js";

function opened(name: string): OpenedMarketplace {
  return {
    tree: { describe: name, files: [], fetchFile: () => Promise.reject(new Error("unused")), fileUrl: (path) => path },
    marketplace: { name, dialect: "cursor", path: ".cursor-plugin/marketplace.json", plugins: [] },
    warnings: [],
  };
}

/** An `open` whose every call is a promise the test settles by hand. */
function controlledOpen() {
  const pending = new Map<string, { resolve: (value: OpenedMarketplace) => void; reject: (error: Error) => void }>();
  const calls: string[] = [];
  const open: OpenSource = (source) =>
    new Promise((resolve, reject) => {
      const key = sourceKeyOf(source);
      calls.push(key);
      pending.set(key, { resolve, reject });
    });
  const settle = async (source: MarketplaceSource, outcome: OpenedMarketplace | Error): Promise<void> => {
    const handlers = pending.get(sourceKeyOf(source));
    if (handlers === undefined) throw new Error(`nothing pending for ${sourceKeyOf(source)}`);
    if (outcome instanceof Error) handlers.reject(outcome);
    else handlers.resolve(outcome);
    await Promise.resolve();
  };
  return { open, settle, calls };
}

const official: KnownMarketplace = { name: "stigmer", source: { type: "official" } };
const cursor: KnownMarketplace = { name: "cursor-plugins", source: { type: "github", repo: "cursor/plugins" } };
const acme: KnownMarketplace = { name: "acme", source: { type: "github", repo: "acme/plugins" } };

describe("MarketplaceCatalogStore", () => {
  it("reads every source at once and settles each on its own, in listing order", async () => {
    const store = new MarketplaceCatalogStore();
    const { open, settle, calls } = controlledOpen();
    let notified = 0;
    store.subscribe(() => notified++);

    store.sync([official, cursor, acme], open);
    expect(calls).toEqual(["official", "github:cursor/plugins@", "github:acme/plugins@"]);
    expect(store.getSnapshot().map((read) => [read.marketplace.name, read.state.kind])).toEqual([
      ["stigmer", "reading"],
      ["cursor-plugins", "reading"],
      ["acme", "reading"],
    ]);

    await settle(acme.source, opened("acme"));
    const snapshot = store.getSnapshot();
    expect(snapshot.map((read) => read.state.kind)).toEqual(["reading", "reading", "ready"]);

    await settle(official.source, new Error("development build"));
    const next = store.getSnapshot();
    expect(next.map((read) => read.state.kind)).toEqual(["failed", "reading", "ready"]);
    // The element that did not change is the same object; only the array and the settled element are new.
    expect(next[2]).toBe(snapshot[2]);
    expect(next[1]).toBe(snapshot[1]);
    expect(next).not.toBe(snapshot);
    expect(notified).toBe(3);
  });

  it("forgets a removed source and drops its late read", async () => {
    const store = new MarketplaceCatalogStore();
    const { open, settle } = controlledOpen();
    store.sync([cursor, acme], open);
    store.sync([cursor], open);
    expect(store.getSnapshot().map((read) => read.marketplace.name)).toEqual(["cursor-plugins"]);

    await settle(acme.source, opened("acme"));
    expect(store.getSnapshot().map((read) => read.marketplace.name)).toEqual(["cursor-plugins"]);
  });

  it("reads again when a name comes back with another repository, and keeps an unchanged source's state", async () => {
    const store = new MarketplaceCatalogStore();
    const { open, settle, calls } = controlledOpen();
    store.sync([cursor, acme], open);
    await settle(cursor.source, opened("cursor"));
    await settle(acme.source, opened("acme"));

    const moved: KnownMarketplace = { name: "acme", source: { type: "github", repo: "acme/other" } };
    store.sync([cursor, moved], open);
    expect(calls).toEqual(["github:cursor/plugins@", "github:acme/plugins@", "github:acme/other@"]);
    expect(store.getSnapshot().map((read) => read.state.kind)).toEqual(["ready", "reading"]);
  });

  it("refetch reads one source again; a read from before it never wins", async () => {
    const store = new MarketplaceCatalogStore();
    const stale = { resolve: (_: OpenedMarketplace) => {} };
    let first = true;
    const open: OpenSource = () =>
      new Promise((resolve) => {
        if (first) {
          first = false;
          stale.resolve = resolve;
        } else {
          resolve(opened("fresh"));
        }
      });
    store.sync([cursor], open);
    store.refetch("cursor-plugins");
    await Promise.resolve();
    const state = store.getSnapshot()[0]?.state;
    expect(state?.kind).toBe("ready");
    if (state?.kind === "ready") expect(state.opened.tree.describe).toBe("fresh");

    stale.resolve(opened("stale"));
    await Promise.resolve();
    const after = store.getSnapshot()[0]?.state;
    if (after?.kind === "ready") expect(after.opened.tree.describe).toBe("fresh");
    else throw new Error("expected the fresh read to stand");
  });

  it("refetch of an unknown name is a no-op", () => {
    const store = new MarketplaceCatalogStore();
    store.sync([], () => Promise.reject(new Error("unused")));
    expect(() => store.refetch("nobody")).not.toThrow();
  });
});
