/**
 * BuildUpdateState — ports steps/build_update_state.go (aligned with
 * Cloud's UpdateOperationBuildNewStateStepV2): full spec replacement from
 * the input, immutable identifiers preserved from the existing resource,
 * the ENTIRE existing status preserved (all system state), and only the
 * audit fields refreshed.
 *
 * Visibility is update-immutable (oss#573): updateVisibility is the ONLY
 * door — every visibility guard lives on those pipelines, so a plain
 * Update that changed the level would bypass them all. A request-carried
 * level is deliberately IGNORED, never rejected: stale manifests
 * re-applied after a console visibility change must not fail the update.
 */
import { clone } from "@bufbuild/protobuf";
import type { DescMessage, Message, MessageShape } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import { create } from "@bufbuild/protobuf";

import {
  ApiResourceAuditSchema,
  ApiResourceAuditInfoSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import { internalError } from "../errors.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import {
  auditActorFor,
  clearStatusField,
  creationAuditOf,
  setAuditReflect,
  updatedAuditInfo,
} from "./defaults.js";
import { EXISTING_RESOURCE_KEY } from "./load-existing.js";
import { hasStatusField, messageFieldByName, metadataOf } from "./shapes.js";

export function newBuildUpdateStateStep<
  Desc extends DescMessage,
>(): PipelineStep<Desc> {
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

      // Full spec replacement: the client sends complete desired state.
      const merged = clone(ctx.schema, ctx.input);

      preserveImmutableFields(merged, existing);

      if (hasStatusField(ctx.schema)) {
        // Client-provided status is discarded, then the existing resource's
        // ENTIRE status (default_instance_id, phase, conditions, …) is
        // carried over — only audit gets refreshed below.
        clearStatusField(ctx.schema, merged);
        copyStatusFromExisting(ctx.schema, merged, existing);
        updateAuditFields(ctx.schema, merged, existing, ctx.callerIdentity);
      }

      ctx.setNewState(merged);
    },
  };
}

/**
 * Go preserveImmutableFields: id, slug, org, and visibility (oss#573) come
 * from the existing resource. metadata.name and the other display fields
 * stay client-updatable.
 */
function preserveImmutableFields(merged: Message, existing: Message): void {
  const mergedMeta = metadataOf(merged);
  const existingMeta = metadataOf(existing);
  if (mergedMeta === undefined || existingMeta === undefined) {
    throw internalError(
      new Error("metadata is nil"),
      "preserve immutable fields",
    );
  }
  mergedMeta.id = existingMeta.id;
  mergedMeta.slug = existingMeta.slug;
  mergedMeta.org = existingMeta.org;
  mergedMeta.visibility = existingMeta.visibility;
}

/** Go copyStatusFromExisting (Cloud ApiResourcePreviousStatusReplacer). */
function copyStatusFromExisting(
  schema: DescMessage,
  merged: Message,
  existing: Message,
): void {
  const existingRoot = reflect(schema, existing);
  const statusField = messageFieldByName(existingRoot, "status");
  if (statusField === undefined || !existingRoot.isSet(statusField)) {
    return;
  }
  // Deep copy: the merged resource must not alias the loaded original.
  const statusCopy = reflect(
    statusField.message,
    clone(statusField.message, existingRoot.get(statusField).message),
  );
  reflect(schema, merged).set(statusField, statusCopy);
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
