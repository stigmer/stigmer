/**
 * Platform default-agent resolution — ports
 * pkg/domain/agent/defaultagent/defaultagent.go: the single resolution
 * implementation behind Agent.GetDefault, AgentExecution create (#17), and
 * Session create.
 *
 * The default agent is a platform-level singleton: the agent labeled
 * stigmer.ai/default-agent: "true" with visibility_public, seeded in the
 * system org and served to callers of every org. Resolution is deliberately
 * GLOBAL — GetDefaultAgentRequest.org exists for authorization scoping only
 * (see apis/ai/stigmer/agentic/agent/v1/io.proto). It powers the
 * session-first UX where a user starts a conversation without picking an
 * agent. The cloud twin is AgentRepo.findDefault(); keep the two in sync.
 *
 * Determinism contract (stigmer/stigmer#356): multiple labeled agents is a
 * reachable state, not an error — safe label rotation applies the new
 * default before retiring the old one. Among public candidates the winner
 * is the one with the LOWEST metadata.id — the incumbent. Rejected
 * alternatives (recorded in the Go package doc): first-match depends on row
 * insertion order; newest-wins lets any newly labeled public agent capture
 * the platform-wide default (nothing guards the reserved stigmer.ai/*
 * namespace at OSS write boundaries); creation time is not trustworthy as
 * an ordering key (pre-#453 rows may carry rewritten timestamps).
 * metadata.id never changes and is time-ordered for server-generated ULIDs.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";

/** Marks the platform default agent; the value must be DEFAULT_AGENT_LABEL_VALUE. */
export const DEFAULT_AGENT_LABEL = "stigmer.ai/default-agent";

/** The only value of DEFAULT_AGENT_LABEL that marks an agent as the default. */
export const DEFAULT_AGENT_LABEL_VALUE = "true";

/**
 * No agent carries the default-agent label. Call sites map this to
 * NotFound with their own caller-facing copy (Go ErrNotConfigured).
 */
export class DefaultAgentNotConfiguredError extends Error {
  constructor() {
    super(
      `no agent labeled ${DEFAULT_AGENT_LABEL}=${DEFAULT_AGENT_LABEL_VALUE}`,
    );
    this.name = "DefaultAgentNotConfiguredError";
  }
}

/**
 * Labeled agents exist but none is visibility_public. Call sites map this
 * to FailedPrecondition — a deliberate divergence from the cloud edition,
 * whose SQL predicate collapses this state into "not found": the distinct
 * code tells a self-hosting operator the label is present but the
 * visibility is wrong (Go ErrNotPublic).
 */
export class DefaultAgentNotPublicError extends Error {
  constructor() {
    super(
      `agents labeled ${DEFAULT_AGENT_LABEL}=${DEFAULT_AGENT_LABEL_VALUE} exist but none is visibility_public`,
    );
    this.name = "DefaultAgentNotPublicError";
  }
}

/**
 * Resolves the platform default agent per the module contract: candidates
 * are all agents labeled DEFAULT_AGENT_LABEL=true, only visibility_public
 * candidates are eligible, and among those the lowest metadata.id wins.
 *
 * Throws DefaultAgentNotConfiguredError when nothing carries the label,
 * DefaultAgentNotPublicError when labeled agents exist but none is public,
 * and lets store/decode failures propagate (a store failure is an internal
 * fault, not a "no default agent" condition — callers must not map it to
 * NotFound).
 */
export async function findDefaultAgent(
  store: Store,
  logger: Logger,
): Promise<Agent> {
  const raws = await store.findAllByLabel(
    ApiResourceKind.agent,
    DEFAULT_AGENT_LABEL,
    DEFAULT_AGENT_LABEL_VALUE,
    AgentSchema,
  );
  if (raws.length === 0) {
    throw new DefaultAgentNotConfiguredError();
  }

  let publicCount = 0;
  let winner: Agent | undefined;
  for (const raw of raws) {
    // findAllByLabel already unmarshaled every returned row to match the
    // label, so a decode failure here is store corruption. Fail loudly
    // (propagate): skipping a row could silently change which agent wins.
    const candidate = fromBinary(AgentSchema, raw);
    if (
      candidate.metadata?.visibility !==
      ApiResourceVisibility.visibility_public
    ) {
      continue;
    }
    publicCount++;
    if (
      winner === undefined ||
      (candidate.metadata?.id ?? "") < (winner.metadata?.id ?? "")
    ) {
      winner = candidate;
    }
  }
  if (winner === undefined) {
    throw new DefaultAgentNotPublicError();
  }

  if (publicCount > 1) {
    // Expected briefly mid-rotation; persistent duplicates mean someone
    // forgot to retire the old label after applying the new default.
    logger.warn(
      "Multiple public agents carry the default-agent label; serving the incumbent (lowest id). Retire the stale label to complete rotation.",
      {
        publicLabeledAgents: publicCount,
        winnerId: winner.metadata?.id ?? "",
        winnerName: winner.metadata?.name ?? "",
      },
    );
  }

  return winner;
}
