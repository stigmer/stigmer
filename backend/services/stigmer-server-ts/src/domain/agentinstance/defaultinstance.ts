/**
 * Default-instance factory — ports
 * pkg/domain/agentinstance/defaultinstance/defaultinstance.go (the OSS twin
 * of the cloud edition's DefaultAgentInstanceFactory; keep the two in sync).
 *
 * Every agent has exactly one default instance: an empty shell with no
 * custom configuration that serves as the fallback when the user has no
 * personal instance. This module is the single source of its naming
 * convention and request shape, shared by every flow that creates one
 * (agent create, session create's self-heal) — in Go, previously four
 * hand-rolled copies that could drift.
 *
 * Default instances carry no visibility of their own: their access always
 * follows the parent agent. metadata.visibility is deliberately left unset
 * here, and visibility updates on default instances are rejected by the
 * agentinstance controller's RejectDefaultInstanceVisibilityUpdate step.
 *
 * Default instances are tagged with two reserved labels (see
 * src/pipeline/apiresource-labels.ts). The labels are descriptive markers
 * matching the cloud edition's stored shape — restrict-shaped decisions
 * must also key on the parent's status.default_instance_id, which is
 * server-owned (labels are client-suppliable, and instances created before
 * this factory existed carry none).
 */
import { create } from "@bufbuild/protobuf";

import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import {
  DEFAULT_INSTANCE_LABEL,
  RESERVED_LABEL_TRUE,
  SYSTEM_MANAGED_LABEL,
} from "../../pipeline/apiresource-labels.js";

// apiVersion / kind match what every creation flow (and the cloud
// edition's resolvers) put on AgentInstance requests.
const API_VERSION = "agentic.stigmer.ai/v1";
const KIND = "AgentInstance";

const SLUG_SUFFIX = "-default";
const DESCRIPTION = "Default instance (auto-created, no custom configuration)";

/**
 * The deterministic slug of an agent's default instance
 * (<agent-slug>-default) — the single source of the naming convention.
 */
export function defaultInstanceSlug(agentSlug: string): string {
  return `${agentSlug}${SLUG_SUFFIX}`;
}

/**
 * Builds the AgentInstance proto for a default-instance creation request
 * from the parent agent's metadata. Callers hand it to the agentinstance
 * in-process client (applyAsSystem), which owns persistence and validation.
 *
 * Taking the metadata rather than loose strings is deliberate: the instance
 * is named from the agent's SLUG — the kebab-case identity — never from the
 * free-form display name. Every historical Go call site passed
 * metadata.name for the slug parameter, which held together only while
 * GenerateSlug(name + "-default") happened to re-derive slug + "-default"
 * (stigmer/stigmer#355); reading the slug at this single source makes the
 * wrong-field mistake unwritable. All callers see a populated slug: create
 * pipelines run after ResolveSlug, and the self-heal paths load an
 * already-persisted parent.
 */
export function buildDefaultInstanceRequest(
  agent: ApiResourceMetadata,
): AgentInstance {
  return create(AgentInstanceSchema, {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      name: defaultInstanceSlug(agent.slug),
      org: agent.org,
      labels: {
        [DEFAULT_INSTANCE_LABEL]: RESERVED_LABEL_TRUE,
        [SYSTEM_MANAGED_LABEL]: RESERVED_LABEL_TRUE,
      },
    },
    spec: {
      agentId: agent.id,
      description: DESCRIPTION,
    },
  });
}
