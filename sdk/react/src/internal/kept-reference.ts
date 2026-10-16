/**
 * A stored reference an editor sends back unchanged: by the id it holds,
 * which every reference stores since references were held by id, so a
 * target renamed while the page was open, or since, is still the one
 * meant, and a deleted one is refused by the reference rule with its own
 * copy. A reference without an id (a row the person just picked) goes by
 * its org and slug. The pinned version rides along: dropping it would move
 * the reference to the target's latest.
 */
import type { ResourceRef } from "@stigmer/client";

/** What an editor read for one reference row. */
export interface ReadReference {
  readonly org: string;
  readonly slug: string;
  readonly id?: string;
  readonly version?: string;
}

/** The reference as the editor sends it back (see the module header). */
export function keptReference(ref: ReadReference): ResourceRef {
  return {
    org: ref.org,
    slug: ref.id ? "" : ref.slug,
    ...(ref.id ? { id: ref.id } : {}),
    ...(ref.version ? { version: ref.version } : {}),
  };
}
