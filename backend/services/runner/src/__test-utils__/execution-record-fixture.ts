/**
 * The four resources of one execution, wired by id into the chain the turn
 * runtime resolves (`execution.spec.sessionId` → `session.spec.
 * agentInstanceId` → `agentInstance.spec.agentId` → the agent), as an
 * `ExecutionRecord` the hermetic client answers from.
 *
 * Harness-agnostic: the record is the control plane's, and the runtime's
 * phases read it the same way whatever engine runs the turn. A harness's
 * driver supplies its own fixture ids and model (`execute-cursor/__test-
 * utils__/hermetic-cursor.ts` `cursorExecutionRecord`); the runtime's own
 * tests use the defaults. Ids are fixed so goldens are readable and
 * byte-stable.
 */

import { create, type JsonObject } from "@bufbuild/protobuf";
import { AgentExecutionSchema, type AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema, ExecutionConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { SessionSchema, type Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { AgentSchema, type Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema, type SubAgent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentInstanceSchema, type AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentInstanceSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { ExecutionRecord, type ExecutionRecordInput } from "./hermetic-activity.js";
import { FIXTURE_MODEL } from "./model-registry-fixture.js";

/** The ids a record's four resources carry. */
export interface ExecutionRecordIds {
  readonly org: string;
  readonly executionId: string;
  readonly sessionId: string;
  readonly agentInstanceId: string;
  readonly agentId: string;
  readonly agentName: string;
}

export const DEFAULT_RECORD_IDS: ExecutionRecordIds = {
  org: "hermetic-org",
  executionId: "aex_hermetic_0001",
  sessionId: "ses_hermetic_0001",
  agentInstanceId: "ain_hermetic_0001",
  agentId: "agt_hermetic_0001",
  agentName: "hermetic-agent",
};

export interface ExecutionRecordOptions {
  /** The user's message for this execution. */
  readonly message: string;
  /** The agent's instructions (system prompt body). */
  readonly instructions?: string;
  /** Session workspace entries (a `local_path` entry turns on capture mode). */
  readonly workspaceEntries?: WorkspaceEntry[];
  /** The requested model; the pinned fixture model when omitted. */
  readonly modelName?: string;
  readonly autoApproveAll?: boolean;
  /**
   * `ExecutionConfig.max_cost_usd`: the per-message cost budget the runtime
   * enforces as a hard stop (cost-guard.ts). Omitted or 0 = no cap, the
   * proto's default. Priced against the registry fixture's round numbers, so
   * a scenario can state its overrun exactly (600 000 input tokens = $0.60).
   */
  readonly maxCostUsd?: number;
  /**
   * `ExecutionConfig.max_tool_rounds`: the hard tool-round budget the engine
   * enforces (native: LangGraph's `recursionLimit`, `shared/tool-rounds.ts`).
   * Omitted or 0 = unlimited, the proto's default. Clamped to the floor of 10
   * by the runner, so a scenario that wants the limit reached scripts a model
   * that keeps calling tools (`repeatLast`).
   */
  readonly maxToolRounds?: number;
  /** `ExecutionConfig.structured_output_schema`: a JSON schema the agent's answer must match. */
  readonly structuredOutputSchema?: JsonObject;
  /** The agent's declared sub-agents (`AgentSpec.sub_agents`). */
  readonly subAgents?: SubAgent[];
  /** The control plane's STOP lever; see `ExecutionRecordInput.controlSignal`. */
  readonly controlSignal?: ExecutionRecordInput["controlSignal"];
  readonly ids?: ExecutionRecordIds;
}

export function executionRecordFixture(options: ExecutionRecordOptions): ExecutionRecord {
  const ids = options.ids ?? DEFAULT_RECORD_IDS;
  const execution: AgentExecution = create(AgentExecutionSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: ids.executionId, org: ids.org, name: ids.executionId }),
    spec: create(AgentExecutionSpecSchema, {
      sessionId: ids.sessionId,
      message: options.message,
      autoApproveAll: options.autoApproveAll ?? false,
      executionConfig: create(ExecutionConfigSchema, {
        modelName: options.modelName ?? FIXTURE_MODEL,
        maxCostUsd: options.maxCostUsd ?? 0,
        maxToolRounds: options.maxToolRounds ?? 0,
        // A `google.protobuf.Struct` field is a plain `JsonObject` in protobuf-es.
        structuredOutputSchema: options.structuredOutputSchema,
      }),
    }),
  });
  const session: Session = create(SessionSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: ids.sessionId, org: ids.org, name: ids.sessionId }),
    spec: create(SessionSpecSchema, {
      agentInstanceId: ids.agentInstanceId,
      workspaceEntries: options.workspaceEntries ?? [],
    }),
  });
  const agentInstance: AgentInstance = create(AgentInstanceSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: ids.agentInstanceId, org: ids.org, name: ids.agentInstanceId }),
    spec: create(AgentInstanceSpecSchema, { agentId: ids.agentId }),
  });
  const agent: Agent = create(AgentSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: ids.agentId, org: ids.org, name: ids.agentName }),
    spec: create(AgentSpecSchema, {
      description: "Hermetic fixture agent",
      instructions: options.instructions ?? "You are the hermetic fixture agent. Answer briefly.",
      subAgents: options.subAgents ?? [],
    }),
  });
  return new ExecutionRecord({ execution, session, agentInstance, agent, controlSignal: options.controlSignal });
}
