/**
 * Rows as the release before the rename of executions to runs wrote them,
 * and their twins as this release writes them, for the driver-neutral test
 * of ../run-rename.ts and both drivers' migration arms. A row built with
 * the old names is what the step reads; the same builder with the new names
 * is what it must leave behind.
 */
import { create, toBinary, type MessageInitShape } from "@bufbuild/protobuf";

import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowTaskSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";

export const RUN_RENAME_ORG = "org_01jz0000000000000000000000";
export const RUN_RENAME_HASH = "a".repeat(64);

/** The names a row spells a run by, before the rename and after. */
export interface RunNames {
  /** An agent run's kind string. */
  readonly agentRunKind: string;
  /** A workflow run's kind string. */
  readonly workflowRunKind: string;
  /** The emit_event signal target's run key. */
  readonly signalKey: string;
  /** The agent_call key naming the child run. */
  readonly childKey: string;
  /** The keys a stored agent_call output names the child run under. */
  readonly childOutputKeys: readonly string[];
}

export const OLD_RUN_NAMES: RunNames = {
  agentRunKind: "AgentExecution",
  workflowRunKind: "WorkflowExecution",
  signalKey: "execution_id",
  childKey: "agent_execution_id",
  childOutputKeys: ["agent_execution_id"],
};

export const NEW_RUN_NAMES: RunNames = {
  agentRunKind: "AgentRun",
  workflowRunKind: "WorkflowRun",
  signalKey: "run_id",
  childKey: "agent_run_id",
  childOutputKeys: ["agent_execution_id", "agent_run_id"],
};

/** An agent run of a session, as a turn's row stores it. */
export function agentRunBytes(id: string, sessionId: string, names: RunNames): Uint8Array {
  return toBinary(
    AgentRunSchema,
    create(AgentRunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: names.agentRunKind,
      metadata: { id, name: id, org: RUN_RENAME_ORG },
      spec: { target: { case: "sessionId", value: sessionId }, message: "hi" },
    }),
  );
}

/** A workflow run with an agent_call task that names its child run, and one that does not. */
export function workflowRunBytes(id: string, workflowId: string, names: RunNames): Uint8Array {
  return toBinary(
    WorkflowRunSchema,
    create(WorkflowRunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: names.workflowRunKind,
      metadata: { id, name: id, org: RUN_RENAME_ORG },
      spec: { workflowId },
      status: {
        workflowVersionHash: RUN_RENAME_HASH,
        tasks: [
          {
            taskName: "triage",
            metadata: { [names.childKey]: "aex_child", token_attribution: "total_only" },
            output: {
              ...Object.fromEntries(names.childOutputKeys.map((key) => [key, "aex_child"])),
              final_text: "done",
            },
          },
          { taskName: "notify", output: { sent: true } },
        ],
      },
    }),
  );
}

/**
 * A workflow's steps: an agent_call, a for_each whose nested emit_event
 * signals a run, and an emit_event that reads the child run in its
 * expressions. One subject is free-form text that spells the child key
 * without being an expression; the step must leave it as written.
 */
export function workflowSteps(names: RunNames): Array<MessageInitShape<typeof WorkflowTaskSchema>> {
  return [
    {
      name: "triage",
      kind: WorkflowTaskKind.agent_call,
      taskConfig: { agent: "triage", message: "Classify the ticket" },
    },
    {
      name: "fanout",
      kind: WorkflowTaskKind.for_each,
      taskConfig: {
        each: "item",
        in: "${ .items }",
        do: [
          {
            name: "notify",
            kind: "emit_event",
            taskConfig: {
              event: { type: "ticket.triaged", data: { run: `\${ .triage.${names.childKey} }` } },
              delivery: [{ signal: { [names.signalKey]: "${ .item.run }", signal_name: "done" } }],
            },
          },
        ],
      },
    },
    {
      name: "emit",
      kind: WorkflowTaskKind.emit_event,
      taskConfig: {
        event: {
          type: "ticket.done",
          subject: "the agent_execution_id field names the child",
          data: { child: `\${ .triage.${names.childKey} }` },
        },
        delivery: [
          { signal: { [names.signalKey]: `\${ .triage.${names.childKey} }`, signal_name: "done" } },
        ],
      },
    },
  ];
}

/** A workflow head or archived version whose steps name runs by `names`. */
export function workflowWithSteps(id: string, names: RunNames, yaml = "document: {}\n") {
  return create(WorkflowSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Workflow",
    metadata: { id, name: id, org: RUN_RENAME_ORG, version: { id: RUN_RENAME_HASH } },
    spec: {
      document: { dsl: "1.0.0", namespace: "test", name: id, version: "0.1.0" },
      tasks: workflowSteps(names),
    },
    status: {
      versionHash: RUN_RENAME_HASH,
      serverlessWorkflowValidation: { yaml },
    },
  });
}
