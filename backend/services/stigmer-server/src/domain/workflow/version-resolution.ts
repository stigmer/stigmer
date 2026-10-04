/**
 * Workflow versions — the workflow's binding of the shared version steps
 * (pipeline/steps/version-history.ts, version-archive.ts): the
 * getByReference ladder, the paginated history, one version by hash, the
 * tag move, and the archive. What is a workflow's is here: the schema, the
 * noun in sentences, the head hash in status.version_hash, the live tag in
 * metadata.version.tag (which a fetched snapshot carries from the audit
 * column, never from the time it was archived), and the
 * WorkflowVersionEntry mapping. Step names are the chain vocabulary the
 * inventory and logs read, kept from the workflow's own steps.
 *
 * Proven by __tests__/workflow.test.ts's version blocks and the
 * conformance suite's workflow reference, history and tag arms.
 */
import { create } from "@bufbuild/protobuf";

import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/command_pb";
import type { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { WorkflowStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/status_pb";
import {
  ListWorkflowVersionsResponseSchema,
  WorkflowVersionEntrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
import type {
  ListWorkflowVersionsResponse,
  WorkflowVersionEntry,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  ApiResourceMetadataSchema,
  ApiResourceMetadataVersionSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import type { Logger } from "../../boot/logger.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { GetByReferenceDesc } from "../../pipeline/steps/authorize-resolved-target.js";
import {
  newArchiveCurrentVersionStep,
  newPopulateVersionStep,
} from "../../pipeline/steps/version-archive.js";
import {
  newLoadAndMapVersionsStep,
  newLoadByReferenceWithVersionStep,
  newLoadForTagVersionStep,
  newResolveBySlugForVersionsStep,
  newTagVersionStep,
} from "../../pipeline/steps/version-history.js";
import type {
  VersionHistoryBinding,
  VersionTagBinding,
} from "../../pipeline/steps/version-history.js";
import type { Store } from "../../store/interface.js";

type WorkflowDesc = typeof WorkflowSchema;
type ListVersionsDesc =
  typeof WorkflowQueryController.method.listVersions.input;
type TagVersionDesc = typeof WorkflowCommandController.method.tagVersion.input;

const headHashOf = (wf: Workflow): string => wf.status?.versionHash ?? "";
const liveTagOf = (wf: Workflow): string => wf.metadata?.version?.tag ?? "";
const overlayTag = (wf: Workflow, tag: string): void => {
  wf.metadata ??= create(ApiResourceMetadataSchema);
  wf.metadata.version ??= create(ApiResourceMetadataVersionSchema);
  wf.metadata.version.tag = tag;
};

/** Where a workflow keeps its hash and its tag, and how its history renders. */
export const workflowVersionBinding: VersionHistoryBinding<
  WorkflowDesc,
  ListVersionsDesc,
  WorkflowVersionEntry,
  ListWorkflowVersionsResponse
> = {
  kind: ApiResourceKind.workflow,
  schema: WorkflowSchema,
  noun: "workflow",
  headHashOf,
  liveTagOf,
  overlayTag,
  input: (req) => req,
  mapEntry: mapWorkflowToVersionEntry,
  response: (versions, nextPageToken, totalCount) =>
    create(ListWorkflowVersionsResponseSchema, {
      versions,
      nextPageToken,
      totalCount,
    }),
};

const workflowTagBinding: VersionTagBinding<WorkflowDesc, TagVersionDesc> = {
  kind: ApiResourceKind.workflow,
  schema: WorkflowSchema,
  noun: "workflow",
  headHashOf,
  liveTagOf,
  overlayTag,
  tagInput: (req) => ({
    resourceId: req.workflowId,
    versionHash: req.versionHash,
    tag: req.tag,
  }),
};

/** The reference + version ladder. */
export function newLoadWorkflowByReferenceStep(
  store: Store,
): PipelineStep<GetByReferenceDesc> {
  return newLoadByReferenceWithVersionStep(
    store,
    workflowVersionBinding,
    "LoadWorkflowByReference",
  );
}

/** Resolves the workflow by org+slug and captures its id and head hash. */
export function newResolveWorkflowBySlugStep(
  store: Store,
): PipelineStep<ListVersionsDesc> {
  return newResolveBySlugForVersionsStep(
    store,
    workflowVersionBinding,
    "ResolveWorkflowBySlug",
  );
}

/** Audit records → entries → one page. */
export function newLoadAndMapWorkflowVersionsStep(
  store: Store,
): PipelineStep<ListVersionsDesc> {
  return newLoadAndMapVersionsStep(
    store,
    workflowVersionBinding,
    "LoadAndMapWorkflowVersions",
  );
}

/** The live workflow the tag move targets. */
export const TAG_VERSION_WORKFLOW_KEY = "tagVersionWorkflow";
/** The head after the move, reconciled to its version's tag. */
export const TAG_VERSION_RESULT_KEY = "tagVersionResult";

export function newLoadWorkflowForTagVersionStep(
  store: Store,
): PipelineStep<TagVersionDesc> {
  return newLoadForTagVersionStep(
    store,
    workflowTagBinding,
    "LoadWorkflowForTagVersion",
    TAG_VERSION_WORKFLOW_KEY,
  );
}

export function newTagWorkflowVersionStep(
  store: Store,
): PipelineStep<TagVersionDesc> {
  return newTagVersionStep(
    store,
    workflowTagBinding,
    "TagWorkflowVersion",
    TAG_VERSION_WORKFLOW_KEY,
    TAG_VERSION_RESULT_KEY,
  );
}

/** The version-metadata rule over status.version_hash. */
export function newPopulateWorkflowVersionStep(): PipelineStep<WorkflowDesc> {
  return newPopulateVersionStep<WorkflowDesc>({
    headHashOf,
    setHeadHash: (wf, hash) => {
      wf.status ??= create(WorkflowStatusSchema);
      wf.status.versionHash = hash;
    },
  });
}

/**
 * SaveVersionAudit — repoint or archive, then the single-holder tag. The
 * create path archives after its last write (the snapshot must carry
 * default_instance_id), so it re-persists a revert itself; the update path
 * persists after the archive.
 */
export function newSaveVersionAuditStep(
  store: Store,
  logger: Logger,
  persistOnRevert: boolean,
): PipelineStep<WorkflowDesc> {
  return newArchiveCurrentVersionStep<WorkflowDesc, WorkflowDesc>(
    store,
    logger,
    {
      stepName: "SaveVersionAudit",
      resourceKey: undefined,
      persistOnRevert,
      schema: WorkflowSchema,
      noun: "workflow",
      headHashOf,
      clearHeadHash: (wf) => {
        if (wf.status !== undefined) {
          wf.status.versionHash = "";
        }
        if (wf.metadata?.version !== undefined) {
          wf.metadata.version.id = "";
        }
      },
      liveTagOf,
      clearLiveTag: (wf) => {
        if (wf.metadata?.version !== undefined) {
          wf.metadata.version.tag = "";
        }
      },
    },
  );
}

/**
 * An archived or live Workflow as a WorkflowVersionEntry. The tag is the
 * caller's, from the audit tag column (the source of truth) or the head's
 * reconciled live tag, never the snapshot's own.
 */
export function mapWorkflowToVersionEntry(
  wf: Workflow,
  isCurrent: boolean,
  tag: string,
): WorkflowVersionEntry {
  const entry = create(WorkflowVersionEntrySchema, { isCurrent, tag });

  if (wf.status !== undefined) {
    entry.versionHash = wf.status.versionHash;
    // The validated YAML for runner/viewer consumption.
    if (wf.status.serverlessWorkflowValidation !== undefined) {
      entry.validatedYaml = wf.status.serverlessWorkflowValidation.yaml;
    }
    const audit = wf.status.audit?.specAudit;
    if (audit !== undefined) {
      entry.appliedAt = audit.updatedAt ?? audit.createdAt;
      entry.appliedBy = audit.updatedBy ?? audit.createdBy;
    }
  }

  if (wf.metadata?.version !== undefined) {
    entry.message = wf.metadata.version.message;
  }

  return entry;
}
