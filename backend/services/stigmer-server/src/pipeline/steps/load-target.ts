/**
 * LoadTarget — ports steps/load_target.go. Get's loader for ID-wrapper
 * inputs (OrganizationId, AgentId, …): loads by id into the
 * TargetResource context key; NotFound when absent.
 *
 * Deliberate divergence from the Go source (ratified 2026-08-26): Go
 * mapped ANY store error to NotFound — a locked file or corrupted page
 * presented as a missing resource, inviting clients to discard real
 * state. Here only the store's typed ResourceNotFoundError is NotFound;
 * anything else rethrows, and the pipeline executor answers a sanitized
 * Internal (see pipeline.ts). The idiom applies at every store-read site
 * (guidelines §Errors).
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { getKindName } from "../apiresource-meta.js";
import { invalidArgumentError, notFoundError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { idValueOf } from "./shapes.js";

/** Context key for the loaded target (Go TargetResourceKey). */
export const TARGET_RESOURCE_KEY = "targetResource";

export function newLoadTargetStep<
  InputDesc extends DescMessage,
  TargetDesc extends DescMessage,
>(store: Store, targetSchema: TargetDesc): PipelineStep<InputDesc> {
  return {
    name: "LoadTarget",
    async execute(ctx: RequestContext<InputDesc>): Promise<void> {
      const resourceId = idValueOf(ctx.input);
      if (resourceId === "") {
        throw invalidArgumentError("resource id is required");
      }

      let target: MessageShape<TargetDesc>;
      try {
        target = await store.getResource(
          ctx.apiResourceKind,
          resourceId,
          targetSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError(getKindName(ctx.apiResourceKind), resourceId);
        }
        throw error;
      }

      ctx.set(TARGET_RESOURCE_KEY, target);
    },
  };
}
