/**
 * The two ways an entry write names its vault: a vault by id, or the
 * caller's own My vault (created by the server on its first write). One
 * construction each, so every hook sends the same target shape.
 */
import { create } from "@bufbuild/protobuf";
import {
  VaultTargetSchema,
  type VaultTarget,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";

/** The caller's own My vault in `org`. */
export function myVaultTarget(org: string): VaultTarget {
  return create(VaultTargetSchema, { org, vault: { case: "mine", value: true } });
}

/** A vault by its id. */
export function vaultTargetById(org: string, id: string): VaultTarget {
  return create(VaultTargetSchema, { org, vault: { case: "id", value: id } });
}
