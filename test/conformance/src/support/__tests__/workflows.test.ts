// Unit arms for two workflow fixture builders the run suites read keys
// through.
// - makeHumanInputWorkflow declares spec.env only when asked, projecting
//   each declaration with its defaults filled, so a gate fixture without
//   keys stays the plain approval workflow.
// - makeAgentCallStepWorkflow carries the step's environment_refs (org and
//   slug alone) in its task_config, places the step at the top level or
//   inside a one-item for_each under the same step name, and prepends the
//   listen gate only when gated.
// Every fixture builds a valid Workflow message.
// Pure: no target.
// Domain: conformance support.
import { create } from "@bufbuild/protobuf";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { describe, expect, it } from "vitest";
import {
  AGENT_CALL_GATE_SIGNAL,
  AGENT_CALL_GATE_TASK_NAME,
  AGENT_CALL_STEP_NAME,
  HUMAN_INPUT_AFTER_TASK_NAME,
  HUMAN_INPUT_TASK_NAME,
  makeAgentCallStepWorkflow,
  makeHumanInputWorkflow,
} from "../workflows";

describe("makeHumanInputWorkflow", () => {
  it("declares no env unless asked", () => {
    const workflow = create(WorkflowSchema, makeHumanInputWorkflow({ org: "acme", name: "gate" }));

    expect(workflow.spec?.tasks.map((t) => t.name)).toEqual([HUMAN_INPUT_TASK_NAME, HUMAN_INPUT_AFTER_TASK_NAME]);
    expect(workflow.spec?.env).toEqual({});
  });

  it("declares the keys it is given, with each declaration's defaults filled", () => {
    const workflow = create(
      WorkflowSchema,
      makeHumanInputWorkflow({
        org: "acme",
        name: "gate",
        env: { API_TOKEN: { isSecret: true }, REGION: { optional: true, description: "deploy region" } },
      }),
    );

    expect(workflow.spec?.env.API_TOKEN).toMatchObject({ isSecret: true, optional: false, description: "" });
    expect(workflow.spec?.env.REGION).toMatchObject({ isSecret: false, optional: true, description: "deploy region" });
  });
});

describe("makeAgentCallStepWorkflow", () => {
  const base = {
    org: "acme",
    name: "step-keys",
    agentSlug: "helper",
    environmentRefs: [{ org: "acme", slug: "shared-keys" }],
  };
  const stepConfig = {
    agent: "helper",
    message: "Say hello.",
    environment_refs: [{ org: "acme", slug: "shared-keys" }],
  };

  it("puts the agent_call step at the top level by default, ungated, carrying its environment refs", () => {
    const workflow = create(WorkflowSchema, makeAgentCallStepWorkflow(base));

    expect(workflow.metadata).toMatchObject({ org: "acme", name: "step-keys" });
    expect(workflow.spec?.tasks).toHaveLength(1);
    const step = workflow.spec?.tasks[0];
    expect(step?.name).toBe(AGENT_CALL_STEP_NAME);
    expect(step?.kind).toBe(WorkflowTaskKind.agent_call);
    expect(step?.taskConfig).toEqual(stepConfig);
  });

  it("copies only each ref's org and slug", () => {
    const withExtra = { org: "acme", slug: "shared-keys", note: "not part of a ref" };
    const workflow = create(WorkflowSchema, makeAgentCallStepWorkflow({ ...base, environmentRefs: [withExtra] }));

    expect(workflow.spec?.tasks[0]?.taskConfig?.environment_refs).toEqual([{ org: "acme", slug: "shared-keys" }]);
  });

  it("nests the same step inside a one-item for_each when asked", () => {
    const workflow = create(WorkflowSchema, makeAgentCallStepWorkflow({ ...base, placement: "for_each" }));

    const loop = workflow.spec?.tasks[0];
    expect(loop?.kind).toBe(WorkflowTaskKind.for_each);
    expect(loop?.taskConfig).toEqual({
      in: '${ ["one"] }',
      each: "item",
      do: [{ name: AGENT_CALL_STEP_NAME, kind: "agent_call", task_config: stepConfig }],
    });
  });

  it("prepends the listen gate on its signal when gated", () => {
    const workflow = create(WorkflowSchema, makeAgentCallStepWorkflow({ ...base, gated: true }));

    const [gate, step] = workflow.spec?.tasks ?? [];
    expect(gate?.name).toBe(AGENT_CALL_GATE_TASK_NAME);
    expect(gate?.kind).toBe(WorkflowTaskKind.listen);
    expect(gate?.taskConfig).toEqual({
      to: { mode: "one", signals: [{ id: AGENT_CALL_GATE_SIGNAL, type: "signal" }] },
    });
    expect(step?.name).toBe(AGENT_CALL_STEP_NAME);
  });
});
