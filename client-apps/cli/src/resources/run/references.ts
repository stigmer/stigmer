// The references a new conversation stores for the resources named on
// `stigmer run` (`--vault`, `--plugin`): one rule for every such flag.
//
// A reference is named as the resource verbs name one (reference.ts): an id,
// an `org/slug`, or a slug in the run's organization. An id is looked up for
// its organization and slug, because a conversation stores references, never
// ids; a slug is sent as written, and the server's reference rule refuses a
// resource that does not exist or that the caller may not use, so nothing is
// read twice. A reference that is no form at all (`acme/`, `/x`, `a/b/c`) is
// refused here, before anything is sent. A reference written the same way
// twice is sent once, in its first position; the same resource written two
// ways (by id and by slug) is sent as given, each time.

import { create } from "@bufbuild/protobuf";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  type ApiResourceReference,
  ApiResourceReferenceSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { UsageError } from "../../errors/index.js";
import { idPrefixesFor, parseReference } from "../reference.js";

/** One run flag naming resources of one kind. */
export interface RunReferenceKind {
  /** The flag as typed, for messages: `--vault`. */
  readonly flag: string;
  /** The resource's noun, for messages: `vault`. */
  readonly noun: string;
  readonly kind: ApiResourceKind;
  /** Read a resource by id, for its organization and slug. */
  get(id: string): Promise<{ readonly metadata?: ApiResourceMetadata }>;
}

/**
 * Resolve each reference to the reference the conversation stores, in
 * order, a reference written twice once. An empty or malformed reference is
 * a usage error.
 */
export async function resolveRunReferences(
  of: RunReferenceKind,
  refs: readonly string[],
  org: string,
): Promise<ApiResourceReference[]> {
  const resolved: ApiResourceReference[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    if (raw.trim() === "") {
      throw new UsageError(`invalid ${of.flag} value: empty; name a ${of.noun} by id, org/slug or slug`);
    }
    const parts = raw.trim().split("/");
    if (parts.length > 2 || parts.some((part) => part === "")) {
      throw new UsageError(`invalid ${of.flag} value '${raw}': name a ${of.noun} by id, org/slug or slug`);
    }
    const parsed = parseReference(raw, org, idPrefixesFor(of.kind));
    let refOrg: string;
    let slug: string;
    if (parsed.kind === "id") {
      const found = await of.get(parsed.id);
      refOrg = found.metadata?.org ?? "";
      slug = found.metadata?.slug ?? "";
      if (slug === "") {
        throw new UsageError(
          `${of.noun} '${raw}' has no slug: a conversation names a ${of.noun} by its organization and slug`,
        );
      }
    } else {
      refOrg = parsed.org;
      slug = parsed.slug;
    }
    const key = `${refOrg}/${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(create(ApiResourceReferenceSchema, { kind: of.kind, org: refOrg, slug }));
  }
  return resolved;
}
