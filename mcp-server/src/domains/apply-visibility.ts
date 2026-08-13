// Declared-visibility follow-up for the apply tools (oss#573).
//
// Plain updates preserve the stored visibility on both editions — the
// updateVisibility RPC is the only door for visibility changes, where the
// server-side guards live (per-kind level support, default-instance
// rejection). So when an apply tool's input declares a visibility and the
// applied resource comes back with a different level (i.e. the resource
// already existed), we follow up with one UpdateVisibility RPC on the same
// controller. The CLI's skill-push and manifest-apply flows do the same.
//
// No-ops are skipped (input omitted visibility, create honored it, or the
// stored level already matches), so an unchanged apply costs nothing extra.
// Guard rejections propagate to the caller's rpcError wrapper — the model
// sees the real FAILED_PRECONDITION / INVALID_ARGUMENT, not a silent lie.

import { create } from "@bufbuild/protobuf";
import type { CallOptions } from "@connectrpc/connect";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { UpdateVisibilityInputSchema, type UpdateVisibilityInput } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

interface HasResourceMetadata {
  metadata?: ApiResourceMetadata;
}

interface UpdateVisibilityClient<T> {
  updateVisibility(input: UpdateVisibilityInput, options?: CallOptions): Promise<T>;
}

/**
 * Land the input-declared visibility through the guarded door when the
 * applied resource's stored level differs. Returns the resource carrying the
 * final visibility (the follow-up's response, or `applied` unchanged when no
 * follow-up was needed).
 */
export async function applyDeclaredVisibility<T extends HasResourceMetadata>(
  client: UpdateVisibilityClient<T>,
  callOptions: CallOptions,
  applied: T,
  declared: ApiResourceVisibility,
): Promise<T> {
  if (declared === ApiResourceVisibility.api_resource_visibility_unspecified) return applied;
  const resourceId = applied.metadata?.id ?? "";
  if (resourceId === "") return applied;
  if (applied.metadata?.visibility === declared) return applied;
  return client.updateVisibility(create(UpdateVisibilityInputSchema, { resourceId, visibility: declared }), callOptions);
}
