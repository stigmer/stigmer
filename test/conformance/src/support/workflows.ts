// Canonical valid Workflow fixtures for the conformance suite.
// Domain: conformance support.
//
// Workflow is the first versioned domain, and its spec is far richer than the
// flat tenancy resources — a document block plus at least one task. These
// builders give the suite one canonical *valid* workflow so version and CRUD
// tests share a single source of truth and vary it deliberately (e.g. change
// `taskVar` to alter the generated CNCF YAML, which changes the version hash —
// the lever the version-history tests pull to force or avoid a new version).
//
// Negative cases (missing spec, missing name, malformed input) are written
// inline in the suite, not here: this module represents validity by construction.
import type { JsonObject, MessageInitShape } from "@bufbuild/protobuf";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { type EnvVarDeclarationInit, makeEnvDeclarations } from "./environments";

export const WORKFLOW_API_VERSION = "agentic.stigmer.ai/v1";
export const WORKFLOW_KIND = "Workflow";

export interface WorkflowSpecOptions {
  // CNCF document namespace; defaults to a stable placeholder.
  namespace?: string;
  // Logical workflow name inside the document block.
  documentName?: string;
  // Value of the single set_vars variable. Changing it changes the generated
  // YAML and therefore the version hash — used to force a new version, or keep
  // it identical to assert idempotency.
  taskVar?: string;
  // Full set_vars variables map, taking precedence over taskVar. Its OBJECT
  // INSERTION ORDER is load-bearing: protobuf-es serializes Struct fields in
  // that order, so permuting keys between two otherwise-identical applies
  // reproduces the wire-order variance real SDKs (Go randomizes proto map
  // marshal order) produce — the lever the order-agnostic idempotency pin
  // pulls (stigmer/stigmer#341). Use non-integer-like keys: JS objects
  // re-order integer-like keys numerically, silently neutralizing the
  // permutation.
  variables?: Record<string, string>;
  // Blueprint env-var declarations projected into spec.env — the least-privilege
  // key whitelist the execution engine filters the merged environment against.
  // Declarations carry no value (that is the instance/runtime job); see envmerge.
  env?: Record<string, EnvVarDeclarationInit>;
}

// A valid single-task WorkflowSpec: one `set_vars` task whose config is a
// google.protobuf.Struct (protobuf-es accepts a plain JSON object for Struct
// fields in the init shape).
export function makeWorkflowSpec(opts: WorkflowSpecOptions = {}): MessageInitShape<typeof WorkflowSpecSchema> {
  return {
    description: "conformance fixture",
    document: {
      dsl: "1.0.0",
      namespace: opts.namespace ?? "conformance",
      name: opts.documentName ?? "conformance-workflow",
      version: "1.0.0",
    },
    tasks: [
      {
        name: "setVars",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: opts.variables ?? { greeting: opts.taskVar ?? "hello" } },
        export: { as: "${ . }" },
      },
    ],
    ...(opts.env !== undefined ? { env: makeEnvDeclarations(opts.env) } : {}),
  };
}

export interface WorkflowOptions extends WorkflowSpecOptions {
  org: string;
  name: string;
  // Apply-time version tag, recorded on the archived version via
  // metadata.version.tag. OSS sets tags this way; the dedicated tagVersion RPC
  // is unimplemented locally.
  tag?: string;
}

// A complete, valid Workflow resource ready to hand to create/apply/update.
export function makeWorkflow(opts: WorkflowOptions): MessageInitShape<typeof WorkflowSchema> {
  const { org, name, tag, namespace, documentName, taskVar, variables } = opts;
  return {
    apiVersion: WORKFLOW_API_VERSION,
    kind: WORKFLOW_KIND,
    metadata: {
      name,
      org,
      ...(tag !== undefined ? { version: { tag } } : {}),
    },
    spec: makeWorkflowSpec({
      namespace: namespace ?? org,
      documentName: documentName ?? name,
      taskVar,
      variables,
    }),
  };
}

export interface WaitWorkflowOptions {
  org: string;
  name: string;
  // How long the single wait task sleeps. Long enough that a test reliably
  // observes IN_PROGRESS and acts (cancel/pause) before completion; the wait is
  // a durable Temporal timer, so it occupies no worker slot while sleeping and a
  // test that cancels never actually waits this long.
  waitSeconds?: number;
}

// A valid single-task Workflow whose only task is a `wait` (Temporal sleep).
// It keeps an execution in EXECUTION_IN_PROGRESS for a controllable duration —
// the lever the lifecycle tests pull to act on a genuinely running execution
// (vs. set_vars, which completes sub-second and would make those tests racy).
// The taskConfig shape mirrors WaitTaskConfig: { duration: { seconds } }.
export function makeWaitWorkflow(opts: WaitWorkflowOptions): MessageInitShape<typeof WorkflowSchema> {
  const { org, name, waitSeconds = 30 } = opts;
  return {
    apiVersion: WORKFLOW_API_VERSION,
    kind: WORKFLOW_KIND,
    metadata: { name, org },
    spec: {
      description: "conformance wait fixture",
      document: { dsl: "1.0.0", namespace: org, name, version: "1.0.0" },
      tasks: [
        {
          name: "waitTask",
          kind: WorkflowTaskKind.wait,
          taskConfig: { duration: { seconds: waitSeconds } },
        },
      ],
    },
  };
}

export interface EnvMergeWorkflowOptions {
  org: string;
  name: string;
  // Blueprint env-var declarations (the whitelist the merged env is filtered to).
  env: Record<string, EnvVarDeclarationInit>;
  // How long the single wait task sleeps. The envmerge suite reads the merged
  // ExecutionContext while the run is non-terminal, so the timer only needs to
  // outlast one read; a test that reads then cancels never waits this long.
  waitSeconds?: number;
}

// A Workflow that declares an env whitelist (spec.env) and whose only task is a
// `wait`. The wait keeps the execution non-terminal so the ephemeral
// ExecutionContext (created synchronously at create-time, deleted on completion)
// is observable via getByExecutionId. Kept separate from makeWaitWorkflow, which
// the lifecycle suite uses untouched and without env declarations.
export function makeEnvMergeWorkflow(opts: EnvMergeWorkflowOptions): MessageInitShape<typeof WorkflowSchema> {
  const { org, name, env, waitSeconds = 30 } = opts;
  return {
    apiVersion: WORKFLOW_API_VERSION,
    kind: WORKFLOW_KIND,
    metadata: { name, org },
    spec: {
      description: "conformance envmerge fixture",
      document: { dsl: "1.0.0", namespace: org, name, version: "1.0.0" },
      tasks: [
        {
          name: "waitTask",
          kind: WorkflowTaskKind.wait,
          taskConfig: { duration: { seconds: waitSeconds } },
        },
      ],
      env: makeEnvDeclarations(env),
    },
  };
}

// The human_input task name and its downstream continue-task name, exported so
// the HITL suite refers to the same identifiers the fixture defines (the gate is
// resolved by task_name, so the two must agree).
export const HUMAN_INPUT_TASK_NAME = "awaitApproval";
export const HUMAN_INPUT_AFTER_TASK_NAME = "afterApproval";

export interface HumanInputOutcomeSpec {
  // Outcome name the reviewer selects; must match SubmitWorkflowTaskApprovalInput.outcome.
  name: string;
  label?: string;
  // When set, selecting this outcome routes the workflow to the named task
  // (the runner's __flow_directive__ jump) instead of continuing in order.
  then?: string;
}

export interface HumanInputWorkflowOptions {
  org: string;
  name: string;
  // Outcomes offered to the reviewer. Defaults to a defined binary approve/deny:
  // both are *data* outcomes that complete the gate (deny does NOT fail the run —
  // failure-on-deny is only the behavior of the implicit, no-outcomes binary
  // form). Provide a custom set to exercise routing (an outcome with `then`).
  outcomes?: HumanInputOutcomeSpec[];
  // Timeout in seconds before on_timeout applies. Omitted/0 = wait indefinitely
  // (the test owns the timing). Set with onTimeout to drive the timeout policy.
  timeout?: number;
  // Policy applied when the timeout expires, as the full proto enum string
  // (e.g. "HUMAN_INPUT_TIMEOUT_FAIL") — this is what the json-schema and the
  // server converter expect, not the runner's internal short form.
  onTimeout?: string;
  // Trailing set_vars tasks appended after `afterApproval`, used as `then`
  // routing targets so an outcome's jump lands on an observable task.
  routedTasks?: string[];
}

// A Workflow whose first task is a `human_input` approval gate. The runner pauses
// the task at WORKFLOW_TASK_WAITING_APPROVAL (execution stays IN_PROGRESS — there
// is no execution-level waiting phase) until submitWorkflowTaskApproval signals
// it; the gate then resumes and the downstream `afterApproval` set_vars proves
// the run continued. The human_input taskConfig is the typed HumanInputTaskConfig
// (snake_case keys, validated by human_input.schema.json with
// additionalProperties:false), which the server converts to CNCF
// `call: human_input`. This is fully hermetic: no LLM, MCP, or storage — only
// Temporal + the runner, exactly like makeWaitWorkflow.
export function makeHumanInputWorkflow(
  opts: HumanInputWorkflowOptions,
): MessageInitShape<typeof WorkflowSchema> {
  const { org, name, timeout, onTimeout, routedTasks = [] } = opts;
  const outcomes = opts.outcomes ?? [{ name: "approve" }, { name: "deny" }];

  const humanInputConfig: JsonObject = {
    prompt: "Conformance approval gate — please respond.",
    outcomes: outcomes.map((o) => ({
      name: o.name,
      ...(o.label !== undefined ? { label: o.label } : {}),
      ...(o.then !== undefined ? { then: o.then } : {}),
    })),
    ...(timeout !== undefined ? { timeout } : {}),
    ...(onTimeout !== undefined ? { on_timeout: onTimeout } : {}),
  };

  return {
    apiVersion: WORKFLOW_API_VERSION,
    kind: WORKFLOW_KIND,
    metadata: { name, org },
    spec: {
      description: "conformance human_input fixture",
      document: { dsl: "1.0.0", namespace: org, name, version: "1.0.0" },
      tasks: [
        {
          name: HUMAN_INPUT_TASK_NAME,
          kind: WorkflowTaskKind.human_input,
          taskConfig: humanInputConfig,
          export: { as: "${ . }" },
        },
        {
          name: HUMAN_INPUT_AFTER_TASK_NAME,
          kind: WorkflowTaskKind.set_vars,
          taskConfig: { variables: { resumed: "true" } },
        },
        ...routedTasks.map((taskName) => ({
          name: taskName,
          kind: WorkflowTaskKind.set_vars,
          taskConfig: { variables: { routed: taskName } },
        })),
      ],
    },
  };
}

// The raise_error task name, exported so the recover suite refers to the same
// identifier the fixture defines.
export const RAISE_ERROR_TASK_NAME = "raiseError";

export interface RaiseErrorWorkflowOptions {
  org: string;
  name: string;
  // Error type/name. The server maps a few well-known names (e.g. "ValidationError")
  // to CNCF error URIs and passes anything else through as the error title; a custom
  // value is therefore a valid, deterministic failure trigger. Defaults to a stable
  // conformance marker.
  errorType?: string;
  // Human-readable failure detail. Both fields are proto-required (min_len=1).
  errorMessage?: string;
}

// A valid single-task Workflow whose only task is a `raise_error`. It always
// reaches EXECUTION_FAILED sub-second with zero external dependencies (no LLM,
// MCP, HTTP, or timer) — the deterministic, hermetic lever for the recover
// happy-path, where re-failure on a fresh orchestrator is the proof recovery
// dispatched a new run. The taskConfig is the typed RaiseTaskConfig
// ({error, message}); the server converts it to CNCF `raise: { error: {...} }`.
export function makeRaiseErrorWorkflow(
  opts: RaiseErrorWorkflowOptions,
): MessageInitShape<typeof WorkflowSchema> {
  const { org, name, errorType = "ConformanceError", errorMessage = "deliberate failure for recover testing" } = opts;
  return {
    apiVersion: WORKFLOW_API_VERSION,
    kind: WORKFLOW_KIND,
    metadata: { name, org },
    spec: {
      description: "conformance raise_error fixture",
      document: { dsl: "1.0.0", namespace: org, name, version: "1.0.0" },
      tasks: [
        {
          name: RAISE_ERROR_TASK_NAME,
          kind: WorkflowTaskKind.raise_error,
          taskConfig: { error: errorType, message: errorMessage },
        },
      ],
    },
  };
}

// The listen task name and its downstream continue-task name, exported so the
// sendSignal suite refers to the same identifiers the fixture defines (the
// downstream task completing is how the suite proves the signal unblocked the gate).
export const LISTEN_TASK_NAME = "awaitSignal";
export const LISTEN_AFTER_TASK_NAME = "afterSignal";

export interface ListenWorkflowOptions {
  org: string;
  name: string;
  // The signal id the listen task blocks on; sendSignal's signal_name must match it.
  signalName: string;
}

// A valid Workflow whose first task is a `listen` (signal mode "one") followed by
// a downstream `set_vars`. The listen task blocks on a Temporal signal channel
// keyed by `signalName` until WorkflowExecution.sendSignal delivers a matching
// signal; the gate then resolves and the downstream `afterSignal` set_vars proves
// the run continued. Fully hermetic: a listen task needs only Temporal + the TS
// runner, exactly like makeWaitWorkflow. The listen taskConfig is the typed
// ListenTaskConfig ({to:{mode,signals:[{id,type}]}}), which the server converts to
// CNCF `listen: { to: { one: { with: {...} } } }`.
export function makeListenWorkflow(opts: ListenWorkflowOptions): MessageInitShape<typeof WorkflowSchema> {
  const { org, name, signalName } = opts;
  return {
    apiVersion: WORKFLOW_API_VERSION,
    kind: WORKFLOW_KIND,
    metadata: { name, org },
    spec: {
      description: "conformance listen fixture",
      document: { dsl: "1.0.0", namespace: org, name, version: "1.0.0" },
      tasks: [
        {
          name: LISTEN_TASK_NAME,
          kind: WorkflowTaskKind.listen,
          taskConfig: { to: { mode: "one", signals: [{ id: signalName, type: "signal" }] } },
        },
        {
          name: LISTEN_AFTER_TASK_NAME,
          kind: WorkflowTaskKind.set_vars,
          taskConfig: { variables: { signal_received: "true" } },
        },
      ],
    },
  };
}

// The agent_call task name and its downstream continue-task name, exported so the
// child-approval suite refers to the same identifiers the fixture defines (the
// downstream task completing is how the suite proves the child resumed).
export const AGENT_CALL_TASK_NAME = "callAgent";
export const AGENT_CALL_AFTER_TASK_NAME = "afterAgent";

export interface AgentCallWorkflowOptions {
  org: string;
  name: string;
  // Slug of the agent the agent_call task invokes (Agent.metadata.slug). The
  // server converts it to the CNCF `with.agent` ref and the runner creates a
  // child AgentExecution for it in the workflow's org.
  agentSlug: string;
  // The message handed to the child agent. agent_call.message is an expression
  // (is_expression), and a constant string is a valid expression; the default
  // nudges the (mock) LLM toward its single tool call.
  message?: string;
}

// A Workflow whose first task is an `agent_call` invoking a tool-using agent,
// followed by a downstream `afterAgent` set_vars. When the child agent gates on a
// tool approval, the gate surfaces at THIS workflow's status.pending_approvals
// (carrying child_agent_execution_id) on editions that emit the
// child_approval_required signal; WorkflowExecution.submitApproval then forwards
// the decision to the child. The downstream set_vars completing is the proof the
// child resumed and the workflow continued.
//
// Unlike the hermetic wait/human_input fixtures, driving the child to its gate
// needs the mock LLM + MCP tool fixture (the agent must reference an
// approval-gated tool), so this pairs with the suite's provisionGatedAgent. It is
// only exercised on the workflowChildApprovalForwarding capability (DD-012).
export function makeAgentCallWorkflow(
  opts: AgentCallWorkflowOptions,
): MessageInitShape<typeof WorkflowSchema> {
  const { org, name, agentSlug, message = "Use the echo tool to echo the word hello." } = opts;
  return {
    apiVersion: WORKFLOW_API_VERSION,
    kind: WORKFLOW_KIND,
    metadata: { name, org },
    spec: {
      description: "conformance agent_call fixture",
      document: { dsl: "1.0.0", namespace: org, name, version: "1.0.0" },
      tasks: [
        {
          name: AGENT_CALL_TASK_NAME,
          kind: WorkflowTaskKind.agent_call,
          taskConfig: { agent: agentSlug, message },
          export: { as: "${ . }" },
        },
        {
          name: AGENT_CALL_AFTER_TASK_NAME,
          kind: WorkflowTaskKind.set_vars,
          taskConfig: { variables: { resumed: "true" } },
        },
      ],
    },
  };
}
