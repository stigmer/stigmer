/**
 * An in-memory name table for the unit rigs of the lanes whose rows this
 * composition keeps (teams, identity providers): the server's one name
 * table (`ComposedServices.resourceNames`) as those lanes meet it, current
 * names only, with no expiry. It claims, resolves and releases as
 * `@stigmer/server`'s store contract pins for a current name; the rename
 * operations are refused, since no rig here renames. The composed suites
 * run the real table.
 *
 * `rowsHold`, when given, makes every row a rig stores hold its name, as
 * the backfill and every create chain make it on a server: a name nobody
 * claimed here resolves to the row of that kind, organization and slug.
 */
import type {
  NameTable,
  ResourceNameEntry,
  ResourceNameKey,
  ResourceNameStore,
} from "@stigmer/server";

/** The table, and its entries for a test's assertions. */
export interface InMemoryNames extends NameTable {
  readonly entries: ReadonlyMap<string, ResourceNameEntry>;
}

export function inMemoryNames(
  rowsHold?: (key: ResourceNameKey) => Promise<string | undefined>,
): InMemoryNames {
  const entries = new Map<string, ResourceNameEntry>();
  const keyOf = (key: ResourceNameKey): string => `${key.kind}\u0000${key.org}\u0000${key.name}`;
  const refused = (): never => {
    throw new Error("the in-memory name table renames nothing");
  };
  const fromRows = async (key: ResourceNameKey): Promise<ResourceNameEntry | undefined> => {
    const id = await rowsHold?.(key);
    return id === undefined
      ? undefined
      : { ...key, id, state: "current", claimedAt: "2026-01-01T00:00:00.000Z", expiresAt: "" };
  };
  const resourceNames: ResourceNameStore = {
    resolve: async (key) => entries.get(keyOf(key)) ?? (await fromRows(key)),
    current: (kind, org, id) =>
      Promise.resolve(
        [...entries.values()].find(
          (entry) => entry.kind === kind && entry.org === org && entry.id === id,
        ),
      ),
    currentMany: (holders) =>
      Promise.resolve(
        [...entries.values()].filter((entry) =>
          entry.state === "current" &&
          holders.some((h) => h.kind === entry.kind && h.org === entry.org && h.id === entry.id),
        ),
      ),
    claim: async (key, id, now) => {
      const held = entries.get(keyOf(key)) ?? (await fromRows(key));
      if (held !== undefined && held.id !== id) {
        return { claimed: false, entry: held };
      }
      const entry: ResourceNameEntry = { ...key, id, state: "current", claimedAt: now, expiresAt: "" };
      entries.set(keyOf(key), entry);
      return { claimed: true, entry };
    },
    rename: refused,
    revertRename: refused,
    release: (kind, org, id) => {
      for (const [key, entry] of entries) {
        if (entry.kind === kind && entry.org === org && entry.id === id) {
          entries.delete(key);
        }
      }
      return Promise.resolve();
    },
    releaseName: (key, id) => {
      if (entries.get(keyOf(key))?.id === id) {
        entries.delete(keyOf(key));
      }
      return Promise.resolve();
    },
  };
  return { resourceNames, entries };
}
