/**
 * A whole `TurnInput` for tests that stand in for the runtime.
 *
 * The contract's input is the runtime's entire resolved record (`harness/
 * types.ts`): the execution and session protos, the blueprint, the
 * environment, the workspace, the tool surface, the attachments, the model
 * preferences, the standing context. A test that drives an adapter WITHOUT
 * the runtime — the harness contract kit's `ExecutionDriver`, a unit test of
 * one adapter step — needs a record that type-checks and is inert: empty
 * protos, an empty tool surface, a workspace under the OS temp dir, a memory
 * selection that answers nothing. Everything here is the neutral value;
 * `overrides` deep-merges one level (a test states the fields it is about
 * and nothing else), the way `testConfig()` does for `Config`.
 *
 * Nothing here is Cursor's or native's: the vision profile, the file-review
 * identity and the state id source are the ADAPTER's capabilities, not
 * input facts, so they do not appear.
 */

import { create } from "@bufbuild/protobuf";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentExecutionSchema,
  type AgentExecution,
  type AgentExecutionStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SessionSchema, type Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import type { TurnInput } from "../harness/types.js";
import type { ResolvedBlueprint } from "../shared/blueprint-resolver.js";
import { mockWorkspaceBackend } from "./mock-workspace.js";

/** The ids a fixture record carries when a test does not name its own. */
export const TURN_INPUT_FIXTURE_IDS = {
  executionId: "aex_fixture_0001",
  sessionId: "ses_fixture_0001",
  agentId: "agt_fixture_0001",
  org: "fixture-org",
} as const;

export interface TurnInputFixtureOverrides extends Partial<Omit<TurnInput, "execution" | "session" | "blueprint">> {
  readonly execution?: AgentExecution;
  readonly session?: Session;
  readonly blueprint?: Partial<ResolvedBlueprint>;
  /**
   * The user's message on the default execution's spec (ignored when a whole
   * `execution` is given). Empty by default: the neutral record asks nothing.
   */
  readonly message?: string;
  /**
   * The status the default execution carries — what the control plane
   * persisted at the end of the previous invocation, on a reinvocation. The
   * runtime seeds the turn's in-progress status from a clone of it
   * (`seedTranscriptFromExecution`) and an adapter may read the record's own
   * copy for its facts, so a test standing in for the runtime hands both.
   */
  readonly persistedStatus?: AgentExecutionStatus;
  /**
   * Where the default workspace lives (ignored when a whole `workspace` is
   * given). A test that only needs "my workspace is here" — because its
   * engine writes into it — states the directory and nothing else of the
   * provision record.
   */
  readonly workspaceDir?: string;
}

/**
 * The neutral record, with `overrides` laid over it one level deep. The
 * `session` and `blueprint.session` are the SAME object, as the runtime
 * guarantees (`bindHarnessState` writes it).
 */
export function turnInputFixture(overrides: TurnInputFixtureOverrides = {}): TurnInput {
  const executionId = overrides.executionId ?? TURN_INPUT_FIXTURE_IDS.executionId;
  const sessionId = overrides.sessionId ?? TURN_INPUT_FIXTURE_IDS.sessionId;
  const session =
    overrides.session ??
    create(SessionSchema, {
      metadata: create(ApiResourceMetadataSchema, { id: sessionId, org: TURN_INPUT_FIXTURE_IDS.org, name: sessionId }),
      spec: create(SessionSpecSchema, {}),
    });
  const execution =
    overrides.execution ??
    create(AgentExecutionSchema, {
      metadata: create(ApiResourceMetadataSchema, { id: executionId, org: TURN_INPUT_FIXTURE_IDS.org, name: executionId }),
      spec: create(AgentExecutionSpecSchema, { sessionId, message: overrides.message ?? "" }),
      status: overrides.persistedStatus,
    });
  const agent = create(AgentSchema, {
    metadata: create(ApiResourceMetadataSchema, {
      id: TURN_INPUT_FIXTURE_IDS.agentId,
      org: TURN_INPUT_FIXTURE_IDS.org,
      name: "fixture-agent",
    }),
    spec: create(AgentSpecSchema, { instructions: "You are the fixture agent." }),
  });
  const workspaceDir = overrides.workspaceDir ?? join(tmpdir(), "stigmer-runner-turn-input-fixture");
  const blueprint: ResolvedBlueprint = {
    agent,
    agentSpec: agent.spec!,
    session,
    sessionSpec: session.spec!,
    instructions: agent.spec!.instructions,
    subAgents: [],
    mergedMcpServerUsages: [],
    mergedSkillRefs: [],
    cloudRepos: [],
    ...overrides.blueprint,
  };
  return {
    executionId,
    threadId: overrides.threadId ?? "",
    turnSeq: overrides.turnSeq ?? 0,
    sessionId,
    approvalDecisions: overrides.approvalDecisions ?? new Map(),
    execution,
    session,
    blueprint,
    environment: overrides.environment ?? { envVars: {}, secretKeys: new Set() },
    workspace: overrides.workspace ?? {
      dirs: [workspaceDir],
      primaryDir: workspaceDir,
      gitWorkspace: false,
      captureMode: false,
      changeSetId: `${executionId}:${overrides.turnSeq ?? 0}`,
      provision: { workspaceDirs: [workspaceDir], provisionResults: [], workspaceBackend: mockWorkspaceBackend() },
    },
    mcp: overrides.mcp ?? {
      servers: [],
      channelMessaging: [],
      leases: { global: false, categories: new Set(), servers: new Set() },
      policies: new Map(),
    },
    skills: overrides.skills ?? [],
    attachments: overrides.attachments ?? { results: [], visionImages: [], visionNotViewable: [] },
    appliedToolCallIds: overrides.appliedToolCallIds ?? new Set(),
    model: overrides.model ?? { requested: "default", serviceTier: ServiceTier.STANDARD, thinkingMode: ThinkingMode.DISABLED },
    structuredOutputSchema: overrides.structuredOutputSchema,
    standing: overrides.standing ?? {
      contextBridge: undefined,
      senderIdentity: undefined,
      sessionContext: undefined,
      declaredPreferences: undefined,
      conversationCatchup: undefined,
      selectRecalledMemories: async () => undefined,
    },
    artifactStorage: overrides.artifactStorage,
  };
}
