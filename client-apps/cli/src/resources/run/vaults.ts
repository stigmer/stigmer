// The vaults a new conversation uses, from `stigmer run --vault <ref>`.
//
// A run carries no keys of its own: each turn reads its sender's My vault
// (unless `--no-my-vault`) and then these vaults, in the order given. A
// reference is named as the vault verbs name one (reference.ts): an id, an
// `org/slug`, or a slug in the run's organization. An id is looked up for its
// organization and slug, because a conversation stores references, never
// ids; a slug is sent as written, and the server's reference rule refuses a
// vault that does not exist or that the caller may not use, so nothing is
// read twice. A reference that is no form at all (`acme/`, `/x`, `a/b/c`) is
// refused here, before anything is sent. A vault written the same way twice
// is sent once, in its first position: the first vault holding a key wins,
// so a second mention would change nothing. The same vault written two ways
// (by id and by slug, or by organization id and slug) is sent as given, each
// time: harmless, for the same reason.

import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  type ApiResourceReference,
  ApiResourceReferenceSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../../errors/index.js";
import { idPrefixesFor, parseReference } from "../reference.js";

/** The vault reads an id lookup needs, injectable for tests. */
export type VaultReader = Pick<Stigmer, "vault">;

/**
 * Resolve each `--vault` reference to the reference the conversation stores,
 * in order, a reference written twice once. An empty or malformed reference
 * is a usage error.
 */
export async function resolveRunVaults(
  client: VaultReader,
  refs: readonly string[],
  org: string,
): Promise<ApiResourceReference[]> {
  const resolved: ApiResourceReference[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    if (raw.trim() === "") {
      throw new UsageError("invalid --vault value: empty; name a vault by id, org/slug or slug");
    }
    const parts = raw.trim().split("/");
    if (parts.length > 2 || parts.some((part) => part === "")) {
      throw new UsageError(`invalid --vault value '${raw}': name a vault by id, org/slug or slug`);
    }
    const parsed = parseReference(raw, org, idPrefixesFor(ApiResourceKind.vault));
    let refOrg: string;
    let slug: string;
    if (parsed.kind === "id") {
      const vault = await client.vault.get(parsed.id);
      refOrg = vault.metadata?.org ?? "";
      slug = vault.metadata?.slug ?? "";
      if (slug === "") {
        throw new UsageError(`vault '${raw}' has no slug: a conversation names a vault by its organization and slug`);
      }
    } else {
      refOrg = parsed.org;
      slug = parsed.slug;
    }
    const key = `${refOrg}/${slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(create(ApiResourceReferenceSchema, { kind: ApiResourceKind.vault, org: refOrg, slug }));
  }
  return resolved;
}
