/**
 * An inline edit as an update (`client.<kind>.update(resource, paths)`):
 * the loaded resource's id and the etag it was read at, the edited fields
 * built through the kind's SDK builder, and the mask paths naming them.
 * A field the edit does not name keeps its stored value, so a teammate's
 * change to another field survives the save; a resource changed since it
 * was loaded refuses the save with ETAG_MISMATCH, and `saveErrorMessage`
 * says so in words a person acts on.
 *
 * An edit is a patch of the kind's SDK input (`AgentInput` and the rest):
 * `name` and `labels` are metadata, `versionMessage` is the save's
 * argument and names no path, and every other key is a spec field, whose
 * path is its proto name (`skillRefs` is `spec.skill_refs`).
 *
 * @internal
 */
import { getErrorReason } from "@stigmer/sdk";

import { toError } from "./toError.js";

/** The loaded resource's metadata an edit reads: its id, the etag it was read at, its name and organization. */
interface LoadedMetadata {
  readonly id: string;
  readonly etag: string;
  readonly name: string;
  readonly org: string;
}

/** A resource as an SDK builder answers it: one with metadata to address. */
interface BuiltResource {
  metadata?: { id: string; etag: string };
}

/** SDK input keys that are metadata, with their mask paths. */
const METADATA_PATHS: Readonly<Record<string, string>> = {
  name: "metadata.name",
  labels: "metadata.labels",
};

/** SDK input keys that never name a path: the address, the save's arguments, and what other doors change. */
const NO_PATH_KEYS: ReadonlySet<string> = new Set(["id", "org", "slug", "visibility", "versionMessage"]);

/** The reasons an update is refused with ABORTED. */
export const ETAG_MISMATCH = "ETAG_MISMATCH";
export const WRITE_CONFLICT = "WRITE_CONFLICT";

/**
 * The resource and the mask paths for an edit of `loaded`: `patch` built
 * through `build`, addressed by `loaded`'s id and carrying the etag it was
 * read at.
 */
export function maskedEdit<I extends { name: string }, R extends BuiltResource>(
  loaded: { readonly metadata?: LoadedMetadata },
  build: (input: I) => R,
  patch: Partial<I>,
): { resource: R; paths: string[] } {
  const meta = loaded.metadata;
  const resource = build({ name: meta?.name ?? "", org: meta?.org ?? "", ...patch } as unknown as I);
  if (resource.metadata !== undefined) {
    resource.metadata.id = meta?.id ?? "";
    resource.metadata.etag = meta?.etag ?? "";
  }
  const paths = Object.keys(patch)
    .filter((key) => !NO_PATH_KEYS.has(key))
    .map((key) => METADATA_PATHS[key] ?? `spec.${snakeCase(key)}`);
  return { resource, paths };
}

/**
 * The words a failed save shows: for a resource changed since it was
 * opened, a notice to reload it (the unsaved edit stays in the form); for
 * one that kept changing while it was saved, a nudge to try again; and
 * otherwise the server's message.
 */
export function saveErrorMessage(err: unknown, noun: string): string {
  switch (getErrorReason(err)?.reason) {
    case ETAG_MISMATCH:
      return `This ${noun} changed since you opened it. Reload it to see the change, then make your edit again.`;
    case WRITE_CONFLICT:
      return `This ${noun} kept changing while your edit was saved. Try again.`;
    default:
      return toError(err).message;
  }
}

function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
