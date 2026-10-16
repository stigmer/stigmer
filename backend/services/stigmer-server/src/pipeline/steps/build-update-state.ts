/**
 * BuildUpdateState — ports steps/build_update_state.go: the new state is
 * the row LoadExisting read with the fields the update's mask names copied
 * from the request (update-mask.ts), so every field the update does not
 * name keeps its stored value: identifiers, the ENTIRE status (all system
 * state) and anything another writer set. Only the audit fields are
 * refreshed. A chain reached without a mask (apply's update arm) names
 * every updatable path, a whole desired state.
 *
 * The kind's refused paths (fields another door owns or the server
 * writes) are passed by its chain: naming one is refused, and one under a
 * broader path keeps its stored value. An etag the request carries must be
 * the stored row's, or the update is refused with ABORTED ETAG_MISMATCH;
 * the row is the one this attempt read, so a guarded write's rerun checks
 * it again.
 *
 * Visibility is update-immutable (oss#573): updateVisibility is the ONLY
 * door — every visibility guard lives on those pipelines, so a plain
 * Update that changed the level would bypass them all. A request-carried
 * level is deliberately IGNORED, never rejected: stale manifests
 * re-applied after a console visibility change must not fail the update.
 */
import { clone } from "@bufbuild/protobuf";
import type { DescMessage, Message, MessageShape } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import { create } from "@bufbuild/protobuf";

import { ApiResourceMetadataVersionSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import {
  ApiResourceAuditSchema,
  ApiResourceAuditInfoSchema,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";

import { internalError } from "../errors.js";
import { etagMismatchError } from "../guarded-write.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  auditActorFor,
  creationAuditOf,
  setAuditReflect,
  updatedAuditInfo,
} from "./defaults.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { hasStatusField, metadataOf } from "./shapes.js";
import {
  applyUpdateMask,
  checkUpdateMask,
  updateMaskOf,
} from "./update-mask.js";
import type { RefusedUpdatePath } from "./update-mask.js";

export interface BuildUpdateStateOptions {
  /** The fields an update of this kind may not name (update-mask.ts). */
  readonly refused?: ReadonlyArray<RefusedUpdatePath>;
}

export function newBuildUpdateStateStep<Desc extends DescMessage>(
  options: BuildUpdateStateOptions = {},
): PipelineStep<Desc> {
  const refused = options.refused ?? [];
  return {
    name: "BuildUpdateState",
    execute(ctx: RequestContext<Desc>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as
        | MessageShape<Desc>
        | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error(
            "existing resource not found in context - LoadExisting must run first",
          ),
          "build update state",
        );
      }

      // An etag the request carries is the caller's word for the row it
      // read: a row that changed since is refused, never merged onto.
      const sentEtag = metadataOf(ctx.newState)?.etag ?? "";
      const storedMeta = metadataOf(existing);
      if (sentEtag !== "" && sentEtag !== (storedMeta?.etag ?? "")) {
        throw etagMismatchError(
          ctx.apiResourceKind,
          storedMeta?.org ?? "",
          storedMeta?.slug ?? "",
        );
      }

      const paths = checkUpdateMask(
        ctx.schema,
        updateMaskOf((key) => ctx.get(key)),
        refused,
      );
      // The stored row, with only the named fields taken from the request.
      const merged = clone(ctx.schema, existing);
      applyUpdateMask(ctx.schema, merged, ctx.newState, existing, paths, refused);
      takeVersionArguments(merged, ctx.newState);

      if (hasStatusField(ctx.schema)) {
        updateAuditFields(ctx.schema, merged, existing, ctx.callerIdentity);
      }

      ctx.setNewState(merged);
    },
  };
}

/**
 * The per-save arguments of a versioned kind's write (metadata.version's
 * message and tag): taken from the request whenever it sets them, and
 * otherwise cleared, since they describe this save and not the stored row.
 */
function takeVersionArguments(merged: Message, request: Message): void {
  // The merged row is the stored one, which LoadExisting read with its
  // metadata; a row with no version and a request naming none is left so.
  const mergedMeta = metadataOf(merged);
  const sent = metadataOf(request)?.version;
  if (mergedMeta === undefined || (mergedMeta.version === undefined && sent === undefined)) {
    return;
  }
  mergedMeta.version ??= create(ApiResourceMetadataVersionSchema, {});
  mergedMeta.version.message = sent?.message ?? "";
  mergedMeta.version.tag = sent?.tag ?? "";
}

/**
 * Go updateAuditFieldsReflect: spec_audit keeps the existing creation
 * identity with a fresh update stamp; status_audit is fully current (the
 * status was rebuilt); both carry event "updated".
 */
function updateAuditFields(
  schema: DescMessage,
  resource: Message,
  existing: Message,
  identity: CallerIdentity,
): void {
  const now = timestampNow();
  const actor = auditActorFor(identity);
  const { createdBy, createdAt } = creationAuditOf(
    schema,
    existing,
    "spec_audit",
  );

  setAuditReflect(
    schema,
    resource,
    create(ApiResourceAuditSchema, {
      specAudit: updatedAuditInfo(createdBy, createdAt, actor, now),
      statusAudit: create(ApiResourceAuditInfoSchema, {
        createdBy: actor,
        createdAt: now,
        updatedBy: actor,
        updatedAt: now,
        event: "updated",
      }),
    }),
  );
}
