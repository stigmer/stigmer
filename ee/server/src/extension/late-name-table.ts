/**
 * The server's one name table (ComposedServices.resourceNames) for a unit
 * built before composeServer returns, in the shape of
 * late-child-organizations.ts: the unit hands its lanes `names` at build
 * time and fills it from its `onComposed`; each call reads what was
 * filled, and a call before that is a boot-order bug, answered with the
 * unit's name. The identity unit's team and identity provider lanes claim,
 * read and release their slugs through it (@stigmer/server's names steps).
 */
import type { NameTable, ResourceNameStore } from "@stigmer/server";

export interface LateNameTable {
  /** The name table a unit's lanes hold; each call reads the composed one. */
  readonly names: NameTable;
  /** Fills the table from the composition (the unit's onComposed). */
  fill(composed: ResourceNameStore): void;
}

export function lateNameTable(unit: string): LateNameTable {
  let held: ResourceNameStore | undefined;
  const composed = (): ResourceNameStore => {
    if (held === undefined) {
      throw new Error(
        `${unit} read the name table before the composition handed it over — a boot-order bug`,
      );
    }
    return held;
  };
  return {
    names: {
      resourceNames: {
        resolve: (key, now) => composed().resolve(key, now),
        current: (kind, org, id) => composed().current(kind, org, id),
        currentMany: (holders) => composed().currentMany(holders),
        claim: (key, id, now) => composed().claim(key, id, now),
        rename: (move) => composed().rename(move),
        revertRename: (move, takenBack) => composed().revertRename(move, takenBack),
        release: (kind, org, id) => composed().release(kind, org, id),
        releaseName: (key, id) => composed().releaseName(key, id),
      },
    },
    fill(table) {
      held = table;
    },
  };
}
