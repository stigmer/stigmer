/**
 * How a client reads a reference the server returned.
 *
 * The server stores a reference by its target's id and names it, in every
 * response, with the target's current slug. A target that was deleted has
 * no name left, so its reference comes back holding an id and an empty
 * slug: that is how a reader tells a deleted target from a live one. A
 * client shows such a reference as "deleted <kind>", builds no link from
 * it, and keeps whatever remove action the surface has, so a person can
 * drop it.
 *
 * Writes are untouched: a client names a reference by `org` and `slug`,
 * and the server resolves the name to the id.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

/**
 * The fields of a reference this module reads: a returned
 * ApiResourceReference, or the SDK's `ResourceRef` lens of one, which
 * carries no id.
 */
export interface ReturnedReference {
  readonly id?: string;
  readonly slug: string;
}

/**
 * Whether a reference the server returned names a resource that was
 * deleted: no slug, and an id (or no id field at all, as in a `ResourceRef`
 * read from a returned reference: a client never writes an empty slug).
 * A reference with neither an id nor a slug is unset, not deleted.
 */
export function isDeletedReference(
  ref: ReturnedReference | null | undefined,
): boolean {
  return ref !== undefined && ref !== null && ref.slug === "" && ref.id !== "";
}

/** The kinds a reference may name, in the words a person reads. */
const KIND_WORDS: Partial<Record<ApiResourceKind, string>> = {
  [ApiResourceKind.agent]: "agent",
  [ApiResourceKind.skill]: "skill",
  [ApiResourceKind.plugin]: "plugin",
  [ApiResourceKind.vault]: "vault",
  [ApiResourceKind.channel_app]: "channel app",
  [ApiResourceKind.federation_issuer]: "identity provider",
};

/** What a deleted target is called: "deleted skill", "deleted agent", and so on. */
export function deletedReferenceLabel(kind: ApiResourceKind): string {
  return `deleted ${KIND_WORDS[kind] ?? "resource"}`;
}
