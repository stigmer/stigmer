// Resource creation for the run path: Run.
//
// Ports the Go CLI's run_create.go. We build the full proto messages and drive
// the generated command controllers directly — the fidelity rule
// resources/apply/handlers.ts states: the SDK's typed `create(input)` wrappers model a
// subset of fields, and our attachments/workspace entries are already proto
// messages, so a round-trip through the input types would be lossy and pointless.

import type { Client } from "@connectrpc/connect";
import { create, type DescService } from "@bufbuild/protobuf";
import { type Run, RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import { InteractionMode, ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Attachment } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import {
  type RunSpec,
  RunSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import {
  type RunConfig,
  RunConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/invocation_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { type SessionSpec, SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SessionSecrets } from "./env.js";
import type { HarnessFlag, RunMode, ServiceTierFlag, ThinkingFlag } from "./prepare.js";

const API_VERSION = "agentic.stigmer.ai/v1";

// Accessor for a raw Connect client over a generated controller — the same seam
// the BackendClient exposes (client.ts) and apply uses (handlers.ts).
export type ControllerFn = <Desc extends DescService>(service: Desc) => Client<Desc>;

/**
 * The agent a new conversation starts on, by reference: the server resolves
 * it, pins the version on the session it creates, and checks every later turn
 * against that pin. An empty version pins the agent's current version.
 */
export interface AgentRefInput {
  readonly org: string;
  readonly slug: string;
  readonly version?: string;
}

/**
 * Inputs for creating a run. The turn's target is one of two
 * things: sessionId continues an existing conversation (whose agent the
 * session already pins), or a new conversation the backend creates from the
 * embedded session_spec. agentRef names the new conversation's agent; with
 * neither, the new conversation runs the built-in assistant.
 *
 * workspaceEntries, harness and sessionSecrets ride the one-call bootstrap
 * (spec.session_spec, stigmer/stigmer#249) and shape the auto-created
 * session. A session's agent, workspace, harness and values are fixed at
 * creation, so with sessionId set they are not sent: the target carries the
 * session id alone. A run carries no values of its own; a conversation's
 * values are set when it starts, or by updating the conversation.
 */
export interface CreateRunInput {
  readonly agentRef?: AgentRefInput;
  readonly sessionId?: string;
  readonly orgId: string;
  readonly message: string;
  /** The run's own values, kept sealed on its conversation. */
  readonly sessionSecrets: SessionSecrets;
  readonly attachments: readonly Attachment[];
  readonly workspaceFileRefs: readonly string[];
  readonly workspaceEntries: readonly WorkspaceEntry[];
  readonly model: string;
  readonly mode: RunMode;
  readonly serviceTier: ServiceTierFlag;
  readonly thinking: ThinkingFlag;
  readonly autoApproveAll: boolean;
  readonly harness: HarnessFlag;
}

/** Create a run. Mirrors Go's createAgentExecution. */
export async function createAgentRun(
  controller: ControllerFn,
  input: CreateRunInput,
): Promise<Run> {
  const run = create(RunSchema, {
    apiVersion: API_VERSION,
    kind: "Run",
    metadata: create(ApiResourceMetadataSchema, { name: runName(), org: input.orgId }),
    spec: create(RunSpecSchema, {
      message: input.message === "" ? "execute" : input.message,
      attachments: [...input.attachments],
      workspaceFileRefs: [...input.workspaceFileRefs],
      autoApproveAll: input.autoApproveAll,
      target: buildTarget(input),
      runConfig: buildRunConfig(input.model, input.serviceTier, input.thinking),
      // Only "plan" maps to a non-default mode; "agent"/"" leave it
      // unspecified (agent).
      interactionMode: input.mode === "plan" ? InteractionMode.PLAN : InteractionMode.UNSPECIFIED,
    }),
  });
  return controller(RunCommandController).create(run);
}

// The turn's target: an existing session by id, or the session_spec of the
// conversation the backend creates for it. An unset target is a new
// conversation with the built-in assistant.
function buildTarget(input: CreateRunInput): RunSpec["target"] {
  const sessionId = input.sessionId ?? "";
  if (sessionId !== "") return { case: "sessionId", value: sessionId };
  const sessionSpec = buildSessionSpec(
    input.agentRef,
    input.workspaceEntries,
    input.harness,
    input.sessionSecrets,
  );
  if (sessionSpec === undefined) return { case: undefined };
  return { case: "sessionSpec", value: sessionSpec };
}

// Build the embedded session spec for the one-call bootstrap
// (stigmer/stigmer#249), or undefined when there is nothing to carry: a plain
// built-in-assistant run sends no session_spec at all. The agent reference
// names the conversation's agent. A resolved harness is stamped explicitly,
// including "native": the value may be a deliberate per-run escape from the
// account's default_harness preference, so it must survive any future change
// to the server-side default. Empty means "no opinion" and stays off the wire
// (server defaults to native). Subject is left empty: the server defaults its
// sentinel and the async title activity replaces it. The server clones this
// spec onto the auto-created session and then clears it from the persisted
// run — the Session resource stays the single source of truth.
function buildSessionSpec(
  agentRef: AgentRefInput | undefined,
  workspaceEntries: readonly WorkspaceEntry[],
  harness: HarnessFlag,
  secrets: SessionSecrets,
): SessionSpec | undefined {
  const hasSecrets = Object.keys(secrets).length > 0;
  if (agentRef === undefined && workspaceEntries.length === 0 && harness === "" && !hasSecrets) {
    return undefined;
  }
  const spec = create(SessionSpecSchema, {
    workspaceEntries: [...workspaceEntries],
    secrets: { ...secrets },
  });
  if (agentRef !== undefined) {
    spec.agentRef = create(ApiResourceReferenceSchema, {
      kind: ApiResourceKind.agent,
      org: agentRef.org,
      slug: agentRef.slug,
      version: agentRef.version ?? "",
    });
  }
  if (harness === "cursor") spec.harness = Harness.CURSOR;
  else if (harness === "native") spec.harness = Harness.NATIVE;
  return spec;
}

// Build the RunConfig this message asks for, or undefined when no flag is set
// so the less specific layers (the agent's run defaults, the operator profile)
// choose. An explicit --service-tier or --thinking value maps to the enum even
// for the base choice ("standard"/"disabled"): sent alone it adjusts the model
// another layer chose (thinking off for one message on an agent whose
// defaults turn it on), and unspecified vs explicit is a load-bearing ledger
// distinction (#357/#772).
function buildRunConfig(
  model: string,
  serviceTier: ServiceTierFlag,
  thinking: ThinkingFlag,
): RunConfig | undefined {
  if (model === "" && serviceTier === "" && thinking === "") return undefined;
  const cfg = create(RunConfigSchema);
  if (model !== "") cfg.modelName = model;
  if (serviceTier === "fast") cfg.serviceTier = ServiceTier.FAST;
  else if (serviceTier === "standard") cfg.serviceTier = ServiceTier.STANDARD;
  if (thinking === "enabled") cfg.thinkingMode = ThinkingMode.ENABLED;
  else if (thinking === "disabled") cfg.thinkingMode = ThinkingMode.DISABLED;
  return cfg;
}

// Unique-enough placeholder name; the backend owns final identity. Go's CLI
// used fmt.Sprintf("execution-%d", time.Now().UnixMicro()); the prefix now
// says run.
function runName(): string {
  return `run-${Date.now() * 1000}`;
}
