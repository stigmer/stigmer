/**
 * Persist — ports steps/persist.go: saves newState through the store
 * (metadata.id must be set by an earlier step). A credential bound to one
 * organization saves no row filed in another (refuse-bound-elsewhere.ts):
 * the backstop under every lane's own check. Only a kind whose rows belong
 * to an organization is judged by `metadata.org`; an API key, owner-only,
 * is judged by the organization it is limited to, which the binding reads
 * itself (authorization/credential-binding.ts).
 *
 * `save` replaces the store's own upsert for a kind whose creation must
 * commit with more than the row (a run's, which appends its session's
 * events in the same transaction, domain/session/events/run-writes.ts);
 * the step's name and place in the chain are the same either way.
 *
 * An update of a renamable kind persists with newPersistOntoLiveRowStep
 * instead, under the same name: the request's state written onto the live
 * row inside the store's atomic write, keeping the row's slug. The state
 * was built from a row loaded earlier, and a rename may have landed since;
 * writing the loaded slug back would leave the row behind the name table
 * (pipeline/steps/rename.ts says why the slug is the rename's alone).
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { getKindName } from "../apiresource-meta.js";
import { internalError, notFoundError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { belongsToAnOrganization } from "../../authorization/credential-binding.js";
import { refuseBoundElsewhere } from "./refuse-bound-elsewhere.js";
import { metadataOf } from "./shapes.js";

export function newPersistStep<Desc extends DescMessage>(
  store: Store,
  save?: (state: MessageShape<Desc>) => Promise<void>,
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
      if (belongsToAnOrganization(ctx.apiResourceKind)) {
        refuseBoundElsewhere(ctx.callerIdentity, metadata.org);
      }
      try {
        await (save === undefined
          ? store.saveResource(
              ctx.apiResourceKind,
              metadata.id,
              ctx.schema,
              ctx.newState,
            )
          : save(ctx.newState));
      } catch (error) {
        throw internalError(error, "failed to save resource to store");
      }
    },
  };
}

/**
 * Persist for an update of a renamable kind: the new state written onto
 * the live row inside the store's atomic read-modify-write, every field
 * from the request but the slug, which stays the row's. The written row
 * becomes the new state, so the steps after it and the response see what
 * landed. A row deleted since the load answers NotFound rather than being
 * written back.
 */
export function newPersistOntoLiveRowStep<Desc extends DescMessage>(
  store: Store,
): PipelineStep<Desc> {
  return {
    name: "Persist",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const metadata = metadataOf(ctx.newState);
      if (metadata === undefined || metadata.id === "") {
        throw internalError(
          new Error("resource ID is empty, cannot persist"),
          "persist",
        );
      }
      if (belongsToAnOrganization(ctx.apiResourceKind)) {
        refuseBoundElsewhere(ctx.callerIdentity, metadata.org);
      }
      const next = ctx.newState;
      let written: MessageShape<Desc>;
      try {
        written = await store.updateResource(
          ctx.apiResourceKind,
          metadata.id,
          ctx.schema,
          (row) => {
            const slug = metadataOf(row)?.slug;
            Object.assign(row, next);
            const rowMetadata = metadataOf(row);
            if (rowMetadata !== undefined && slug !== undefined) {
              rowMetadata.slug = slug;
            }
          },
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError(getKindName(ctx.apiResourceKind), metadata.id);
        }
        throw internalError(error, "failed to save resource to store");
      }
      ctx.setNewState(written);
    },
  };
}
