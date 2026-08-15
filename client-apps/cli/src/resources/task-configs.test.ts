import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { type Workflow, WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import {
  WorkflowTaskKind,
  WorkflowTaskKindSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { decodeWorkflowTaskConfigs, TASK_CONFIG_SCHEMAS } from "./task-configs.js";

function makeWorkflow(tasks: JsonValue): Workflow {
  return fromJson(WorkflowSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Workflow",
    metadata: { name: "decode-test", org: "acme" },
    spec: {
      description: "task-config decode fixture",
      document: { dsl: "1.0.0", namespace: "acme", name: "decode-test", version: "1.0.0" },
      tasks,
    },
  }) as Workflow;
}

describe("TASK_CONFIG_SCHEMAS", () => {
  // The stigmer/stigmer#353 drift class: hold the map and the proto enum to
  // strict bidirectional equality, so a new task kind cannot ship without a
  // CLI schema binding and a retired kind cannot linger in the map. The
  // server-side twin of this promise is unmarshalTaskConfig's kind switch.
  it("covers every WorkflowTaskKind exactly (bidirectional)", () => {
    const declaredKinds = WorkflowTaskKindSchema.values
      .map((v) => v.number as WorkflowTaskKind)
      .filter((n) => n !== WorkflowTaskKind.workflow_task_kind_unspecified)
      .sort((a, b) => a - b);
    const mappedKinds = [...TASK_CONFIG_SCHEMAS.keys()].sort((a, b) => a - b);
    expect(mappedKinds).toEqual(declaredKinds);
  });
});

describe("decodeWorkflowTaskConfigs", () => {
  it("rejects the string duration form a real apply rejects (the #778 repro)", () => {
    const workflow = makeWorkflow([
      { name: "conditional_wait", kind: "wait", task_config: { duration: "5s" } },
    ]);
    expect(() => decodeWorkflowTaskConfigs(workflow)).toThrow(
      /task 'conditional_wait' \(wait\): invalid task_config/,
    );
  });

  it("accepts the typed duration object", () => {
    const workflow = makeWorkflow([
      { name: "cooldown", kind: "wait", task_config: { duration: { seconds: 5 } } },
    ]);
    expect(() => decodeWorkflowTaskConfigs(workflow)).not.toThrow();
  });

  it("rejects unknown task_config fields, mirroring the server's strict decode", () => {
    const workflow = makeWorkflow([
      {
        name: "gate",
        kind: "human_input",
        task_config: { prompt: "Approve?", escalation_task: "somewhere" },
      },
    ]);
    expect(() => decodeWorkflowTaskConfigs(workflow)).toThrow(/gate.*human_input.*task_config/);
  });

  it("rejects values outside an enum's membership", () => {
    const workflow = makeWorkflow([
      {
        name: "gate",
        kind: "human_input",
        task_config: { prompt: "Approve?", timeout: 60, on_timeout: "sometimes" },
      },
    ]);
    expect(() => decodeWorkflowTaskConfigs(workflow)).toThrow(/gate.*invalid task_config/);
  });

  it("accepts the agent_call DSL shorthands a real apply accepts (never stricter)", () => {
    const workflow = makeWorkflow([
      {
        name: "review",
        kind: "agent_call",
        task_config: {
          agent: "acme/code-reviewer",
          message: "Review ${ $context.pr.diff }",
          harness: "cursor",
          run_config: { model_name: "composer-2.5", service_tier: "fast" },
          environment_refs: [{ slug: "shared-secrets" }],
        },
      },
    ]);
    expect(() => decodeWorkflowTaskConfigs(workflow)).not.toThrow();
  });

  it("skips tasks without a task_config (protovalidate territory, not decode truth)", () => {
    const workflow = makeWorkflow([{ name: "bare", kind: "set_vars" }]);
    expect(() => decodeWorkflowTaskConfigs(workflow)).not.toThrow();
  });
});
