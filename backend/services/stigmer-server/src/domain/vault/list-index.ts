/**
 * The vault list index (store/list-index.ts): `vault.list` reads one
 * organization's vaults (every declaration's first fact) instead of
 * decoding every vault on the server, and `person` lets a reader ask for
 * one person's My vault rows (a member's departure, the conformance
 * suite's checks) without a scan. A shared vault has no person, and an
 * empty value is no key, so shared vaults read by organization alone.
 *
 * A change to `keys` bumps `revision` (boot/__tests__/list-indexes.test.ts
 * pins the pair).
 */
import { fromBinary } from "@bufbuild/protobuf";

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field } from "../../store/list-index.js";

export const vaultListIndex = declareListIndex({
  kind: ApiResourceKind.vault,
  schema: VaultSchema,
  revision: 1,
  keys: {
    person: field("spec.person"),
  },
});

/** The rows a list read, decoded; a row that does not decode is no vault a list can show. */
export function decodeVaultRows(rows: ReadonlyArray<{ readonly data: Uint8Array }>): Vault[] {
  const vaults: Vault[] = [];
  for (const row of rows) {
    try {
      vaults.push(fromBinary(VaultSchema, row.data));
    } catch {
      continue;
    }
  }
  return vaults;
}
