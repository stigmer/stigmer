/**
 * Delete steps — port steps/delete.go: ExtractResourceId (ID-wrapper →
 * context), LoadExistingForDelete (loads the doomed resource so Delete can
 * return it; NotFound when absent), DeleteResource (the store delete).
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { getKindName } from "../apiresource-meta.js";
import { internalError, invalidArgumentError, notFoundError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { idValueOf } from "./shapes.js";

/** Context key for the extracted id (Go ResourceIdKey). */
export const RESOURCE_ID_KEY = "resourceId";

export function newExtractResourceIdStep<Desc extends DescMessage>(): PipelineStep<Desc> {
  return {
    name: "ExtractResourceId",
    execute(ctx: RequestContext<Desc>): void {
      const id = idValueOf(ctx.input);
      if (id === "") {
        throw invalidArgumentError("resource id is required");
      }
      ctx.set(RESOURCE_ID_KEY, id);
    },
  };
}

export function newLoadExistingForDeleteStep<
  InputDesc extends DescMessage,
  ResourceDesc extends DescMessage,
>(store: Store, resourceSchema: ResourceDesc): PipelineStep<InputDesc> {
  return {
    name: "LoadExistingForDelete",
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      const id = requireResourceId(ctx);

      let resource: MessageShape<ResourceDesc>;
      try {
        resource = await store.getResource(
          ctx.apiResourceKind,
          id,
          resourceSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError(getKindName(ctx.apiResourceKind), id);
        }
        throw error;
      }

      ctx.set(EXISTING_RESOURCE_KEY, resource);
    },
  };
}

export function newDeleteResourceStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "DeleteResource",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const id = requireResourceId(ctx);
      try {
        await store.deleteResource(ctx.apiResourceKind, id);
      } catch (error) {
        throw internalError(
          error,
          `failed to delete ${getKindName(ctx.apiResourceKind)}`,
        );
      }
    },
  };
}

function requireResourceId<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
): string {
  const id = ctx.get(RESOURCE_ID_KEY);
  if (typeof id !== "string" || id === "") {
    throw internalError(
      new Error("resource id not found in context (ExtractResourceId must run first)"),
      "delete pipeline ordering",
    );
  }
  return id;
}
