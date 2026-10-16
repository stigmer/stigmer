/**
 * LoadByReference — ports steps/load_by_reference.go. GetByReference's
 * loader: validates the reference (kind mismatch → InvalidArgument;
 * org-scoped kinds require an org for a slug — RequireOrgForReference),
 * resolves by id, or by slug in its org, stores under TargetResource.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../store/interface.js";
import { getKindName } from "../apiresource-meta.js";
import { invalidArgumentError, notFoundError } from "../errors.js";
import { apiResourceKindName } from "../../store/proto-fields.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { requireOrgForReference } from "./helpers.js";
import { findByReference } from "./references.js";
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
      if (ref.slug === "" && ref.id === "") {
        throw invalidArgumentError("slug or id is required in reference");
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

      if (ref.id === "") {
        requireOrgForReference(kind, ref.org);
      }

      const target: MessageShape<TargetDesc> | undefined =
        await findByReference(store, kind, targetSchema, ref);
      if (target === undefined) {
        throw notFoundError(getKindName(kind), ref.slug !== "" ? ref.slug : ref.id);
      }

      ctx.set(TARGET_RESOURCE_KEY, target);
    },
  };
}
