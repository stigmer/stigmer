/**
 * ValidateVisibility(+Update) — port steps/validate_visibility.go.
 * Fail-fast rejection of visibility levels the kind does not support,
 * BEFORE any state is built — cloud-identical INVALID_ARGUMENT copy, so
 * clients see one contract across editions.
 *
 * Create-only by design: plain updates preserve stored visibility
 * unconditionally (oss#573), so updateVisibility is the only other door
 * and ValidateVisibilityUpdate guards it (placed AFTER the handler's load
 * step to preserve cross-edition error precedence: unknown id + bad level
 * = NOT_FOUND on both editions).
 *
 * Deliberate divergences from Cloud, ported as-is: no platform-anchor
 * check (OSS has no IdentityProvider domain) and skill push is not wired
 * (Cloud's push handler does not validate either) — do not "fix" these.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  supportedVisibilityLevels,
  supportsVisibility,
} from "../apiresource-meta.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
} from "../errors.js";
import { apiResourceKindName } from "../../store/proto-fields.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { metadataOf } from "./shapes.js";

export function newValidateVisibilityStep<Desc extends DescMessage>(): PipelineStep<Desc> {
  return {
    name: "ValidateVisibility",
    execute(ctx: RequestContext<Desc>): void {
      const metadata = metadataOf(ctx.input);
      if (metadata === undefined) {
        return; // no metadata to validate — other steps own that failure
      }
      rejectUnsupportedVisibility(ctx.apiResourceKind, metadata.visibility);
    },
  };
}

export function newValidateVisibilityUpdateStep(): PipelineStep<
  typeof UpdateVisibilityInputSchema
> {
  return {
    name: "ValidateVisibilityUpdate",
    execute(ctx: RequestContext<typeof UpdateVisibilityInputSchema>): void {
      rejectUnsupportedVisibility(ctx.apiResourceKind, ctx.input.visibility);
    },
  };
}

/**
 * Go RejectDefaultInstanceVisibilityUpdate: the canonical
 * FAILED_PRECONDITION for a visibility update aimed at a system-managed
 * default instance — the copy is cloud-identical and conformance-pinned;
 * the PREDICATE lives in the instance controllers' own guard steps.
 */
export function rejectDefaultInstanceVisibilityUpdate(): never {
  throw failedPreconditionError(
    "Default instances do not have their own visibility - access always follows " +
      "the parent blueprint. Change the blueprint's visibility instead.",
  );
}

/** Go rejectUnsupportedVisibility (the shared level check + copy). */
function rejectUnsupportedVisibility(
  kind: ApiResourceKind,
  visibility: ApiResourceVisibility,
): void {
  let supported: boolean;
  let levels: string;
  try {
    supported = supportsVisibility(kind, visibility);
    levels = supportedVisibilityLevels(kind);
  } catch (error) {
    throw internalError(error, "failed to resolve visibility config from kind");
  }
  if (supported) {
    return;
  }
  throw invalidArgumentError(
    `${apiResourceKindName(kind)} resources cannot be set to ${ApiResourceVisibility[visibility]}. Supported visibility levels: ${levels}.`,
  );
}
