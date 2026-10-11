// The vaults a new conversation uses, from `stigmer run --vault <ref>`.
//
// A run carries no keys of its own: each turn reads its sender's My vault
// (unless `--no-my-vault`) and then these vaults, in the order given. Each
// reference resolves by the one rule every run flag naming resources shares
// (references.ts). A vault written twice is sent once, in its first
// position: the first vault holding a key wins, so a second mention would
// change nothing.

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { resolveRunReferences } from "./references.js";

/** The vault reads an id lookup needs, injectable for tests. */
export type VaultReader = Pick<Stigmer, "vault">;

/**
 * Resolve each `--vault` reference to the reference the conversation stores,
 * in order, a reference written twice once. An empty or malformed reference
 * is a usage error.
 */
export function resolveRunVaults(
  client: VaultReader,
  refs: readonly string[],
  org: string,
): Promise<ApiResourceReference[]> {
  return resolveRunReferences(
    { flag: "--vault", noun: "vault", kind: ApiResourceKind.vault, get: (id) => client.vault.get(id) },
    refs,
    org,
  );
}
