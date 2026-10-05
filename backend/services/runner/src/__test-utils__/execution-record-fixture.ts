/**
 * The three resources of one execution, wired by id the way the turn
 * runtime reads them (the session the execution's target names; the agent
 * and version its status stamps, as the server stamps every turn at
 * create; the session naming the same agent by reference), as an
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
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema, ExecutionConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { SessionSchema, type Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { AgentSchema, type Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema, type HookSource, type SubAgent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { ExecutionRecord, type ExecutionRecordInput } from "./hermetic-activity.js";
import { FIXTURE_MODEL } from "./model-registry-fixture.js";

/** The ids a record's three resources carry. */
export interface ExecutionRecordIds {
  readonly org: string;
  readonly executionId: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly agentName: string;
  /** The agent version the turn is stamped with (and the session pins). */
  readonly agentVersionHash: string;
}

export const DEFAULT_RECORD_IDS: ExecutionRecordIds = {
  org: "hermetic-org",
  executionId: "aex_hermetic_0001",
  sessionId: "ses_hermetic_0001",
  agentId: "agt_hermetic_0001",
  agentName: "hermetic-agent",
  agentVersionHash: "0".repeat(64),
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
   * enforces (native: the execution budget middleware's round count,
   * `shared/tool-rounds.ts`).
   * Omitted or 0 = unlimited, the proto's default. Clamped to the floor of 10
   * by the runner, so a scenario that wants the limit reached scripts a model
   * that keeps calling tools (`repeatLast`).
   */
  readonly maxToolRounds?: number;
  /** `ExecutionConfig.structured_output_schema`: a JSON schema the agent's answer must match. */
  readonly structuredOutputSchema?: JsonObject;
  /** The agent's declared sub-agents (`AgentSpec.sub_agents`). */
  readonly subAgents?: SubAgent[];
  /** The agent's `AgentSpec.tools` ("only these"), in Claude Code's names. */
  readonly tools?: string[];
  /** The agent's `AgentSpec.disallowed_tools` ("never these"). */
  readonly disallowedTools?: string[];
  /** The agent's `AgentSpec.hooks`: plugin references and its own hooks block. */
  readonly hooks?: HookSource[];
  /**
   * The built-in assistant: the session names NO agent and the turn's stamp
   * is empty, so the record carries no agent and the activity must run on
   * the one built-in prompt with the session's own tools. `instructions`
   * and `subAgents` are ignored (there is no agent to declare them).
   */
  readonly builtInAssistant?: boolean;
  /** The control plane's STOP lever; see `ExecutionRecordInput.controlSignal`. */
  readonly controlSignal?: ExecutionRecordInput["controlSignal"];
  readonly ids?: ExecutionRecordIds;
}

export function executionRecordFixture(options: ExecutionRecordOptions): ExecutionRecord {
  const ids = options.ids ?? DEFAULT_RECORD_IDS;
  const builtIn = options.builtInAssistant === true;
  const execution: AgentExecution = create(AgentExecutionSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: ids.executionId, org: ids.org, name: ids.executionId }),
    spec: create(AgentExecutionSpecSchema, {
      target: { case: "sessionId", value: ids.sessionId },
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
    status: create(AgentExecutionStatusSchema, {
      agentId: builtIn ? "" : ids.agentId,
      agentVersionHash: builtIn ? "" : ids.agentVersionHash,
    }),
  });
  const session: Session = create(SessionSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: ids.sessionId, org: ids.org, name: ids.sessionId }),
    spec: create(SessionSpecSchema, {
      agentRef: builtIn
        ? undefined
        : create(ApiResourceReferenceSchema, { kind: ApiResourceKind.agent, org: ids.org, slug: ids.agentName }),
      workspaceEntries: options.workspaceEntries ?? [],
    }),
    status: {
      agentId: builtIn ? "" : ids.agentId,
      agentVersionHash: builtIn ? "" : ids.agentVersionHash,
    },
  });
  if (builtIn) {
    return new ExecutionRecord({
      execution,
      session,
      agent: undefined,
      controlSignal: options.controlSignal,
    });
  }
  const agent: Agent = create(AgentSchema, {
    metadata: create(ApiResourceMetadataSchema, { id: ids.agentId, org: ids.org, name: ids.agentName, slug: ids.agentName }),
    spec: create(AgentSpecSchema, {
      description: "Hermetic fixture agent",
      instructions: options.instructions ?? "You are the hermetic fixture agent. Answer briefly.",
      subAgents: options.subAgents ?? [],
      tools: options.tools ?? [],
      disallowedTools: options.disallowedTools ?? [],
      hooks: options.hooks ?? [],
    }),
  });
  return new ExecutionRecord({ execution, session, agent, controlSignal: options.controlSignal });
}
