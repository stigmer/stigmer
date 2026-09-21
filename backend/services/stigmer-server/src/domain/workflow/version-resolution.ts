/**
 * Workflow version resolution — the getByReference ladder as a pipeline
 * step, so the lane can carry the resolved-target authorization the
 * position-1 annotation cannot express (the target is a slug, not a field).
 *
 * The ladder is the Go query.go read, moved here from the direct handler
 * without a behaviour change: slug required; org required (a workflow's slug
 * is unique only within an org); kind mismatch refused with Go's rendering
 * (the NAME for defined values, the bare NUMBER for unknown ones, because
 * ref.kind carries no defined_only rule and enumToJson would throw on the
 * unknown arm); the slug scan's store failure wrapped so a raw storage error
 * never crosses the wire as Unknown; empty or "latest" is the current head;
 * a version matching the head's hash or tag is the head; otherwise the
 * audit store by hash or tag, with the snapshot's tag overlaid from the
 * audit column (the source of truth) so callers never see a stale embedded
 * tag after a tag move. The resolved row lands under TARGET_RESOURCE_KEY,
 * the loader contract every getByReference chain shares.
 *
 * Deliberately NOT the shared ladder in pipeline/steps/version-history.ts:
 * that one decodes through the typed audit reads and carries no tag
 * overlay, so folding the two would change what one of them returns for a
 * moved tag. Consolidating them is a separate change with its own proof.
 *
 * Proven by __tests__/workflow.test.ts's getByReference block and the
 * conformance suite's workflow reference arms.
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import {
  ApiResourceMetadataSchema,
  ApiResourceMetadataVersionSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { GetByReferenceDesc } from "../../pipeline/steps/authorize-resolved-target.js";
import {
  findResourceBySlug,
  requireOrgForReference,
} from "../../pipeline/steps/helpers.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { AuditNotFoundError } from "../../store/interface.js";
import type { AuditRecord, Store } from "../../store/interface.js";

/** A 64-hex value is an exact content hash; anything else is a tag. */
const WORKFLOW_HASH_PATTERN = /^[a-f0-9]{64}$/;

export function newLoadWorkflowByReferenceStep(
  store: Store,
): PipelineStep<GetByReferenceDesc> {
  return {
    name: "LoadWorkflowByReference",
    async execute(ctx: RequestContext<GetByReferenceDesc>): Promise<void> {
      const ref = ctx.input;
      if (ref.slug === "") {
        throw invalidArgumentError("slug is required in reference");
      }

      requireOrgForReference(ApiResourceKind.workflow, ref.org);

      if (
        ref.kind !== ApiResourceKind.api_resource_kind_unknown &&
        ref.kind !== ApiResourceKind.workflow
      ) {
        const got = ApiResourceKind[ref.kind] ?? String(ref.kind);
        throw invalidArgumentError(
          `kind mismatch: expected ${ApiResourceKind[ApiResourceKind.workflow]}, got ${got}`,
        );
      }

      let mainWorkflow: Workflow | undefined;
      try {
        mainWorkflow = await findResourceBySlug(
          store,
          ApiResourceKind.workflow,
          WorkflowSchema,
          ref.slug,
          ref.org,
        );
      } catch (error) {
        throw internalError(error, "failed to list workflows");
      }
      if (mainWorkflow === undefined) {
        throw notFoundError("workflow", ref.slug);
      }

      const version = ref.version.trim();
      if (
        version === "" ||
        version === "latest" ||
        workflowMatchesVersion(mainWorkflow, version)
      ) {
        ctx.set(TARGET_RESOURCE_KEY, mainWorkflow);
        return;
      }

      const archived = await findAuditWorkflowByVersion(
        store,
        mainWorkflow.metadata!.id,
        version,
      );
      if (archived === undefined) {
        throw notFoundError("workflow version", `${ref.slug}:${version}`);
      }
      ctx.set(TARGET_RESOURCE_KEY, archived);
    },
  };
}

function workflowMatchesVersion(wf: Workflow, version: string): boolean {
  if (wf.status === undefined) {
    return false;
  }
  if (WORKFLOW_HASH_PATTERN.test(version)) {
    return wf.status.versionHash === version;
  }
  return wf.metadata?.version?.tag === version;
}

async function findAuditWorkflowByVersion(
  store: Store,
  workflowId: string,
  version: string,
): Promise<Workflow | undefined> {
  let rec: AuditRecord;
  try {
    rec = WORKFLOW_HASH_PATTERN.test(version)
      ? await store.getAuditRecordByHash(
          ApiResourceKind.workflow,
          workflowId,
          version,
        )
      : await store.getAuditRecordByTag(
          ApiResourceKind.workflow,
          workflowId,
          version,
        );
  } catch (error) {
    if (error instanceof AuditNotFoundError) {
      return undefined;
    }
    throw internalError(error, "failed to query workflow audit by version");
  }

  let wf: Workflow;
  try {
    wf = fromBinary(WorkflowSchema, rec.data);
  } catch (error) {
    throw internalError(error, "failed to decode archived workflow version");
  }
  // Overlay the authoritative tag (audit column) onto the snapshot's
  // metadata.version.tag — the snapshot's embedded tag is only correct as
  // of archival time.
  wf.metadata ??= create(ApiResourceMetadataSchema);
  wf.metadata.version ??= create(ApiResourceMetadataVersionSchema);
  wf.metadata.version.tag = rec.tag;
  return wf;
}
