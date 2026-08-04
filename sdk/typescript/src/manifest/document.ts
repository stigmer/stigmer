// Build a ManifestDocument directly from a live resource proto.
//
// The programmatic sibling of `parseManifest`: where parsing starts from
// YAML text, this starts from a proto the server already returned (a
// `get`/`getByReference` result). It exists for lossless partial edits —
// clone the fetched proto, change one field, apply the whole thing — so
// callers never have to down-convert a proto into a curated `*Input`
// shape (which cannot express every metadata field and would silently
// drop the ones it can't carry).

import type { Message } from "@bufbuild/protobuf";
import { metadataOf, type ManifestDocument } from "./parse.js";
import { manifestHandlerForTypeName, manifestKinds } from "./registry.js";

/**
 * Wrap a resource proto as a {@link ManifestDocument} ready for
 * `stigmer.manifest.apply()`.
 *
 * The resource kind is derived from the message's proto type, so any
 * registry-supported resource works with the same call. The message is
 * passed through untouched — full fidelity, no serialization round-trip.
 * The server ignores client-provided `status` on apply, so a fetched
 * proto (status included) is safe to send as-is.
 *
 * @param message - A resource proto of a registry-supported kind, with
 *   `metadata.name` set (always true for server-returned resources).
 * @returns A document ready for `ManifestClient.apply`.
 * @throws {Error} When the message's kind is not in the manifest
 *   registry, or the message has no `metadata.name`.
 *
 * @example
 * ```ts
 * import { clone } from "@bufbuild/protobuf";
 * import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
 *
 * const schedule = await stigmer.schedule.getByReference({ org, slug });
 * const updated = clone(ScheduleSchema, schedule);
 * updated.spec!.enabled = false;
 * await stigmer.manifest.apply(manifestDocumentForResource(updated));
 * ```
 */
export function manifestDocumentForResource(message: Message): ManifestDocument {
  const handler = manifestHandlerForTypeName(message.$typeName);
  if (handler === undefined) {
    const supported = manifestKinds()
      .map((h) => h.yamlKind)
      .join(", ");
    throw new Error(
      `Cannot apply ${message.$typeName} as a manifest: kind is not ` +
        `in the manifest registry. Supported kinds: ${supported}.`,
    );
  }

  const metadata = metadataOf(message);
  const name = metadata?.name ?? "";
  if (name === "") {
    throw new Error(
      `Cannot apply this ${handler.displayName}: metadata.name is empty. ` +
        "Pass a resource as returned by the server (get/getByReference).",
    );
  }

  return {
    handler,
    message,
    name,
    slug: metadata?.slug || name,
    org: metadata?.org ?? "",
  };
}
