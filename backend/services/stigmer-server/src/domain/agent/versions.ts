/**
 * Agent versions — the agent's binding of the shared version steps
 * (pipeline/steps/version-history.ts, version-archive.ts): the hash, the
 * version-metadata rule, the archive, the delete cleanup, the
 * getByReference ladder, the paginated history, one version by hash and the
 * tag move. What is an agent's is here:
 *   - the version is the stored spec, hashed through the canonical JSON
 *     rendering (pipeline/steps/spec-hash.ts) after MergeMcpServerEnvSpecs,
 *     so the hash covers what is stored and what a turn runs, not the
 *     request;
 *   - the head hash lives in status.version_hash and the live tag in
 *     metadata.version.tag, which a fetched snapshot carries from the audit
 *     column;
 *   - an entry carries the version's full spec (spec_snapshot), which is
 *     what a turn recorded on that version runs.
 * The archive runs after Persist on create (the snapshot carries the
 * persisted row), so it re-persists a revert there; on update Persist
 * follows it.
 *
 * Proven by __tests__/agent-versions.test.ts and the agent conformance
 * suite's version arms.
 */
import { clone, create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import type { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/status_pb";
import {
  AgentVersionEntrySchema,
  ListAgentVersionsResponseSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import type {
  AgentVersionEntry,
  ListAgentVersionsResponse,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/version_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  ApiResourceMetadataSchema,
  ApiResourceMetadataVersionSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import type { Logger } from "../../boot/logger.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import type { GetByReferenceDesc } from "../../pipeline/steps/authorize-resolved-target.js";
import { canonicalSpecHash } from "../../pipeline/steps/spec-hash.js";
import {
  VERSION_HASH_KEY,
  newArchiveCurrentVersionStep,
  newDeleteVersionArchivesStep,
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

type AgentDesc = typeof AgentSchema;
type ListVersionsDesc = typeof AgentQueryController.method.listVersions.input;
type TagVersionDesc = typeof AgentCommandController.method.tagVersion.input;
type DeleteDesc = typeof AgentCommandController.method.delete.input;

const headHashOf = (agent: Agent): string => agent.status?.versionHash ?? "";
const liveTagOf = (agent: Agent): string =>
  agent.metadata?.version?.tag ?? "";
const overlayTag = (agent: Agent, tag: string): void => {
  agent.metadata ??= create(ApiResourceMetadataSchema);
  agent.metadata.version ??= create(ApiResourceMetadataVersionSchema);
  agent.metadata.version.tag = tag;
};

/** Where an agent keeps its hash and its tag, and how its history renders. */
export const agentVersionBinding: VersionHistoryBinding<
  AgentDesc,
  ListVersionsDesc,
  AgentVersionEntry,
  ListAgentVersionsResponse
> = {
  kind: ApiResourceKind.agent,
  schema: AgentSchema,
  noun: "agent",
  headHashOf,
  liveTagOf,
  overlayTag,
  input: (req) => req,
  mapEntry: mapAgentToVersionEntry,
  response: (versions, nextPageToken, totalCount) =>
    create(ListAgentVersionsResponseSchema, {
      versions,
      nextPageToken,
      totalCount,
    }),
};

const agentTagBinding: VersionTagBinding<AgentDesc, TagVersionDesc> = {
  kind: ApiResourceKind.agent,
  schema: AgentSchema,
  noun: "agent",
  headHashOf,
  liveTagOf,
  overlayTag,
  tagInput: (req) => ({
    resourceId: req.agentId,
    versionHash: req.versionHash,
    tag: req.tag,
  }),
};

/** ComputeAgentVersionHash — the stored spec's canonical hash, under VERSION_HASH_KEY. */
export function newComputeAgentVersionHashStep(): PipelineStep<AgentDesc> {
  return {
    name: "ComputeAgentVersionHash",
    execute(ctx: RequestContext<AgentDesc>): void {
      const spec = ctx.newState.spec ?? create(AgentSpecSchema);
      ctx.set(VERSION_HASH_KEY, canonicalSpecHash(AgentSpecSchema, spec));
    },
  };
}

/** The version-metadata rule over status.version_hash. */
export function newPopulateAgentVersionStep(): PipelineStep<AgentDesc> {
  return newPopulateVersionStep<AgentDesc>({
    headHashOf,
    setHeadHash: (agent, hash) => {
      agent.status ??= create(AgentStatusSchema);
      agent.status.versionHash = hash;
    },
  });
}

/** SaveVersionAudit — repoint or archive, then the single-holder tag. */
export function newSaveAgentVersionStep(
  store: Store,
  logger: Logger,
  persistOnRevert: boolean,
): PipelineStep<AgentDesc> {
  return newArchiveCurrentVersionStep<AgentDesc, AgentDesc>(store, logger, {
    stepName: "SaveVersionAudit",
    resourceKey: undefined,
    persistOnRevert,
    schema: AgentSchema,
    noun: "agent",
    headHashOf,
    clearHeadHash: (agent) => {
      if (agent.status !== undefined) {
        agent.status.versionHash = "";
      }
      if (agent.metadata?.version !== undefined) {
        agent.metadata.version.id = "";
      }
    },
    liveTagOf,
    clearLiveTag: (agent) => {
      if (agent.metadata?.version !== undefined) {
        agent.metadata.version.tag = "";
      }
    },
    showArchivedTag: overlayTag,
  });
}

/**
 * DeleteAgentVersions — the agent's version rows go with it, as a skill's
 * and a plugin's do: no read path serves a deleted resource's history (its
 * grants go with it). A turn that ran the agent keeps the agent id and
 * version it recorded as plain facts.
 */
export function newDeleteAgentVersionsStep(
  store: Store,
  logger: Logger,
): PipelineStep<DeleteDesc> {
  return newDeleteVersionArchivesStep(store, logger, {
    stepName: "DeleteAgentVersions",
    noun: "agent",
  });
}

/** The reference + version ladder. */
export function newLoadAgentByReferenceStep(
  store: Store,
): PipelineStep<GetByReferenceDesc> {
  return newLoadByReferenceWithVersionStep(
    store,
    agentVersionBinding,
    "LoadAgentByReference",
  );
}

/** Resolves the agent by org+slug and captures its id and head hash. */
export function newResolveAgentBySlugStep(
  store: Store,
): PipelineStep<ListVersionsDesc> {
  return newResolveBySlugForVersionsStep(
    store,
    agentVersionBinding,
    "ResolveAgentBySlug",
  );
}

/** Audit records → entries → one page. */
export function newLoadAndMapAgentVersionsStep(
  store: Store,
): PipelineStep<ListVersionsDesc> {
  return newLoadAndMapVersionsStep(
    store,
    agentVersionBinding,
    "LoadAndMapAgentVersions",
  );
}

/** The live agent the tag move targets. */
export const TAG_VERSION_AGENT_KEY = "tagVersionAgent";
/** The head after the move, reconciled to its version's tag. */
export const TAG_VERSION_RESULT_KEY = "tagVersionResult";

export function newLoadAgentForTagVersionStep(
  store: Store,
): PipelineStep<TagVersionDesc> {
  return newLoadForTagVersionStep(
    store,
    agentTagBinding,
    "LoadAgentForTagVersion",
    TAG_VERSION_AGENT_KEY,
  );
}

export function newTagAgentVersionStep(
  store: Store,
): PipelineStep<TagVersionDesc> {
  return newTagVersionStep(
    store,
    agentTagBinding,
    "TagAgentVersion",
    TAG_VERSION_AGENT_KEY,
    TAG_VERSION_RESULT_KEY,
  );
}

/**
 * An archived or live Agent as an AgentVersionEntry. The tag is the
 * caller's, from the audit tag column or the head's reconciled live tag.
 */
export function mapAgentToVersionEntry(
  agent: Agent,
  isCurrent: boolean,
  tag: string,
): AgentVersionEntry {
  const entry = create(AgentVersionEntrySchema, { isCurrent, tag });
  if (agent.status !== undefined) {
    entry.versionHash = agent.status.versionHash;
    const audit = agent.status.audit?.specAudit;
    if (audit !== undefined) {
      entry.appliedAt = audit.updatedAt ?? audit.createdAt;
      entry.appliedBy = audit.updatedBy ?? audit.createdBy;
    }
  }
  if (agent.metadata?.version !== undefined) {
    entry.message = agent.metadata.version.message;
  }
  if (agent.spec !== undefined) {
    entry.specSnapshot = clone(AgentSpecSchema, agent.spec);
  }
  return entry;
}
