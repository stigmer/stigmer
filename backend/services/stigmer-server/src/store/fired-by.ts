/**
 * How the fire ledger stores who fired a routine: the caller's audit actor
 * (ApiResourceAuditActor) as its protobuf bytes, NULL for a schedule's own
 * fire, which nobody fired. One encoding for both drivers, so a row one
 * wrote reads the same through the other.
 *
 * Pinned by the fire ledger's arms of __tests__/store-contract.ts.
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";

import { ApiResourceAuditActorSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import type { ApiResourceAuditActor } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

/** The column's value for `actor`: its bytes, or null when the fire has none. */
export function encodeFiredBy(actor: ApiResourceAuditActor | undefined): Uint8Array | null {
  return actor === undefined ? null : toBinary(ApiResourceAuditActorSchema, actor);
}

/** The actor a column's value holds, or undefined for NULL. */
export function decodeFiredBy(bytes: Uint8Array | null): ApiResourceAuditActor | undefined {
  return bytes === null ? undefined : fromBinary(ApiResourceAuditActorSchema, bytes);
}
