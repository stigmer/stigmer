/**
 * Persist — ports steps/persist.go: saves newState through the store
 * (metadata.id must be set by an earlier step).
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { Store } from "../../store/interface.js";
import { internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { metadataOf } from "./shapes.js";

export function newPersistStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "Persist",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined) {
        throw internalError(new Error("resource metadata is nil"), "persist");
      }
      if (metadata.id === "") {
        throw internalError(
          new Error("resource ID is empty, cannot persist"),
          "persist",
        );
      }
      try {
        await store.saveResource(
          ctx.apiResourceKind,
          metadata.id,
          ctx.schema,
          ctx.newState,
        );
      } catch (error) {
        throw internalError(error, "failed to save resource to store");
      }
    },
  };
}
