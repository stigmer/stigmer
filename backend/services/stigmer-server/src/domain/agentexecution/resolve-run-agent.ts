/**
 * ResolveRunAgent — stamps the agent a turn runs, and the exact version of
 * it, onto the new execution's status (agent_id, agent_version_hash).
 * Every later reader takes the stamp: the context build here and on
 * recover, and the runner's blueprint hydration. So an author saving a new
 * version while the turn is queued or running never changes what runs,
 * and a session repointed to another agent afterwards never changes which
 * agent the turn records.
 *
 * The agent is the one the turn is bound to: the instance the
 * default-instance step resolved, else the session's instance (the walk
 * the workflow's version pin takes, by store point reads). The session has
 * been created by now, and BuildNewState has discarded any client-sent
 * status, so nothing a client sends reaches either field; the runner's
 * status merge never writes them.
 *
 * Stamps nothing for the built-in assistant (a session with no instance:
 * no stored agent). A bound agent with no recorded version (last written
 * before agents were versioned, or its last version failed to archive)
 * stamps its id alone, and the turn runs that agent as it is. A row that
 * cannot be found is left to the context build that follows, which refuses
 * with the missing row named; a store fault is Internal.
 *
 * Proven by __tests__/resolve-run-agent.test.ts and the agent conformance
 * suite's turn arms.
 */
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import { internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { truncateHash } from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

import { DEFAULT_INSTANCE_ID_KEY } from "./create-steps.js";

type CreateDesc = typeof AgentExecutionSchema;

export function newResolveRunAgentStep(
  store: Store,
  logger: Logger,
): PipelineStep<CreateDesc> {
  return {
    name: "ResolveRunAgent",
    async execute(ctx) {
      const execution = ctx.newState;

      const resolved = ctx.get(DEFAULT_INSTANCE_ID_KEY);
      let instanceId = typeof resolved === "string" ? resolved : "";
      if (instanceId === "") {
        const sessionId = execution.spec?.sessionId ?? "";
        if (sessionId === "") {
          return;
        }
        const session = await readRow(
          store,
          ApiResourceKind.session,
          sessionId,
          SessionSchema,
        );
        instanceId = session?.spec?.agentInstanceId ?? "";
      }
      if (instanceId === "") {
        return;
      }

      const instance = await readRow(
        store,
        ApiResourceKind.agent_instance,
        instanceId,
        AgentInstanceSchema,
      );
      const agentId = instance?.spec?.agentId ?? "";
      if (agentId === "") {
        return;
      }
      const agent = await readRow(
        store,
        ApiResourceKind.agent,
        agentId,
        AgentSchema,
      );
      if (agent === undefined) {
        return;
      }

      const versionHash = agent.status?.versionHash ?? "";
      execution.status ??= create(AgentExecutionStatusSchema);
      execution.status.agentId = agentId;
      execution.status.agentVersionHash = versionHash;
      logger.debug("Stamped the agent version this turn runs", {
        agentId,
        versionHash: truncateHash(versionHash),
      });
    },
  };
}

/** A point read whose absence is a normal outcome here; a store fault is Internal. */
async function readRow<Desc extends DescMessage>(
  store: Store,
  kind: ApiResourceKind,
  id: string,
  schema: Desc,
): Promise<MessageShape<Desc> | undefined> {
  try {
    return await store.getResource(kind, id, schema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw internalError(error, "failed to resolve the agent this turn runs");
  }
}
