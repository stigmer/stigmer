/**
 * LoadByReference — ports steps/load_by_reference.go. GetByReference's
 * loader: validates the reference (kind mismatch → InvalidArgument;
 * org-scoped kinds require an org — RequireOrgForReference), resolves by
 * slug with optional org narrowing, stores under TargetResource.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../store/interface.js";
import { getKindName } from "../apiresource-meta.js";
import { invalidArgumentError, notFoundError } from "../errors.js";
import { apiResourceKindName } from "../../store/proto-fields.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { requireOrgForReference } from "./helpers.js";
import { findResourceByName } from "./names.js";
import { TARGET_RESOURCE_KEY } from "./load-target.js";

export function newLoadByReferenceStep<TargetDesc extends DescMessage>(
  store: Store,
  targetSchema: TargetDesc,
): PipelineStep<typeof ApiResourceReferenceSchema> {
  return {
    name: "LoadByReference",
    async execute(
      ctx: RequestContext<typeof ApiResourceReferenceSchema>,
    ): Promise<void> {
      const ref = ctx.input;
      if (ref.slug === "") {
        throw invalidArgumentError("slug is required in reference");
      }

      const kind = ctx.apiResourceKind;
      if (
        ref.kind !== ApiResourceKind.api_resource_kind_unknown &&
        ref.kind !== kind
      ) {
        throw invalidArgumentError(
          `kind mismatch: expected ${apiResourceKindName(kind)}, got ${apiResourceKindName(ref.kind)}`,
        );
      }

      requireOrgForReference(kind, ref.org);

      const target: MessageShape<TargetDesc> | undefined =
        await findResourceByName(store, kind, targetSchema, ref.org, ref.slug);
      if (target === undefined) {
        throw notFoundError(getKindName(kind), ref.slug);
      }

      ctx.set(TARGET_RESOURCE_KEY, target);
    },
  };
}
