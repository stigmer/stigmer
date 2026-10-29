/**
 * An in-memory name table for the unit rigs of the lanes whose rows this
 * composition keeps (teams, federation issuers): the server's one name
 * table (`ComposedServices.resourceNames`) as those lanes meet it. It
 * claims, resolves and releases as `@stigmer/server`'s store contract pins
 * for a current name, and renames as it pins a rename: the new name
 * current, every other current name of the id previous until the move's
 * `fromExpiresAt`, a held name refused, an id's own previous name taken
 * back, and a revert restoring both. An expired previous name resolves to
 * nothing and is free. The composed suites run the real table.
 *
 * `rowsHold`, when given, makes every row a rig stores hold its name, as
 * the backfill and every create chain make it on a server: a name nobody
 * claimed here resolves to the row of that kind, organization and slug.
 * `nameOrganization` gives an organization id its slug, as an
 * organization's create does, for copy that names the organization.
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
  /** Whether an entry still holds its name at `now` (a previous name until it expires). */
  const live = (entry: ResourceNameEntry, now: string): boolean =>
    entry.state === "current" || entry.expiresAt === "" || entry.expiresAt > now;
  const fromRows = async (key: ResourceNameKey): Promise<ResourceNameEntry | undefined> => {
    const id = await rowsHold?.(key);
    return id === undefined
      ? undefined
      : { ...key, id, state: "current", claimedAt: "2026-01-01T00:00:00.000Z", expiresAt: "" };
  };
  const resourceNames: ResourceNameStore = {
    resolve: async (key, now) => {
      const held = entries.get(keyOf(key));
      if (held !== undefined) {
        return live(held, now) ? held : undefined;
      }
      return fromRows(key);
    },
    current: (kind, org, id) =>
      Promise.resolve(
        [...entries.values()].find(
          (entry) => entry.kind === kind && entry.org === org && entry.id === id && entry.state === "current",
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
      const stored = entries.get(keyOf(key));
      const held = stored !== undefined && live(stored, now) ? stored : stored === undefined ? await fromRows(key) : undefined;
      if (held !== undefined && held.id !== id) {
        return { claimed: false, entry: held };
      }
      const entry: ResourceNameEntry = { ...key, id, state: "current", claimedAt: now, expiresAt: "" };
      entries.set(keyOf(key), entry);
      return { claimed: true, entry };
    },
    rename: async (move) => {
      const toKey = { kind: move.kind, org: move.org, name: move.to };
      const stored = entries.get(keyOf(toKey));
      const held =
        stored !== undefined && live(stored, move.now) ? stored : stored === undefined ? await fromRows(toKey) : undefined;
      if (held !== undefined && held.id !== move.id) {
        return { claimed: false, entry: held };
      }
      const takenBack = held !== undefined && held.state === "previous" ? held : undefined;
      for (const [key, entry] of entries) {
        if (entry.kind === move.kind && entry.org === move.org && entry.id === move.id && entry.state === "current") {
          entries.set(key, { ...entry, state: "previous", claimedAt: move.now, expiresAt: move.fromExpiresAt });
        }
      }
      const entry: ResourceNameEntry = { ...toKey, id: move.id, state: "current", claimedAt: move.now, expiresAt: "" };
      entries.set(keyOf(toKey), entry);
      return takenBack === undefined ? { claimed: true, entry } : { claimed: true, entry, takenBack };
    },
    revertRename: (move, takenBack) => {
      const toKey = keyOf({ kind: move.kind, org: move.org, name: move.to });
      if (entries.get(toKey)?.id === move.id) {
        if (takenBack === undefined) {
          entries.delete(toKey);
        } else {
          entries.set(toKey, takenBack);
        }
      }
      const fromKey = keyOf({ kind: move.kind, org: move.org, name: move.from });
      const from = entries.get(fromKey);
      const otherCurrent = [...entries.values()].some(
        (entry) => entry.kind === move.kind && entry.org === move.org && entry.id === move.id && entry.state === "current",
      );
      if (from?.id === move.id && !otherCurrent) {
        entries.set(fromKey, { ...from, state: "current", expiresAt: "" });
      }
      return Promise.resolve();
    },
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

/** Gives the organization `id` the current slug `slug` in the table, as its create would. */
export async function nameOrganization(names: NameTable, id: string, slug: string): Promise<void> {
  await names.resourceNames.claim({ kind: "organization", org: "", name: slug }, id, new Date().toISOString());
}
