/**
 * Cross-reference validation tests — pin the Go crossref.go behavior:
 * unknown kinds, duplicate names, flow.then / fallback_task /
 * cases[].then / outcomes[].then resolution with did-you-mean, "end"
 * sentinel handling, cycle detection, and the surface rules (the
 * workspace-entries rule, the run_workflow refusal, and the walk that
 * carries both into nested control-flow tasks and compensate lists).
 * Message strings are the cross-edition contract.
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import type { WorkflowSpec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

import {
  validateCrossTaskReferences,
  validateTaskConfigSurfaceRules,
  validateTaskKinds,
} from "../crossref.js";

function spec(
  tasks: Array<{
    name: string;
    kind: WorkflowTaskKind;
    taskConfig?: JsonObject;
    flow?: { then: string };
  }>,
): WorkflowSpec {
  return create(WorkflowSpecSchema, {
    document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
    tasks,
  });
}

const SET = (name: string, then?: string) => ({
  name,
  kind: WorkflowTaskKind.set_vars,
  taskConfig: { variables: { k: "v" } } as JsonObject,
  ...(then !== undefined ? { flow: { then } } : {}),
});

describe("validateTaskKinds", () => {
  it("rejects unspecified and unknown kind values with the pinned message", () => {
    const s = spec([
      { name: "z", kind: 0 as WorkflowTaskKind },
      { name: "u", kind: 9999 as WorkflowTaskKind },
    ]);
    expect(validateTaskKinds(s)).toEqual([
      "task 'z': unknown or unspecified task kind (value=0)",
      "task 'u': unknown or unspecified task kind (value=9999)",
    ]);
  });

  it("accepts every known kind", () => {
    expect(validateTaskKinds(spec([SET("a")]))).toEqual([]);
  });
});

describe("validateCrossTaskReferences", () => {
  it("reports duplicate task names with both indices", () => {
    const errors = validateCrossTaskReferences(spec([SET("dup"), SET("dup")]));
    expect(errors).toContain(
      'duplicate task name "dup" at tasks[1]: already defined at tasks[0]',
    );
  });

  it("resolves flow.then, honors the end sentinel, suggests near-misses", () => {
    const errors = validateCrossTaskReferences(
      spec([SET("start", "finsih"), SET("finish", "end")]),
    );
    expect(errors).toEqual([
      "task 'start' flow.then references unknown task 'finsih' (did you mean 'finish'?)",
    ]);
  });

  it("omits the suggestion when nothing is within distance 3", () => {
    const errors = validateCrossTaskReferences(
      spec([SET("start", "wholly-unrelated-target")]),
    );
    expect(errors).toEqual([
      "task 'start' flow.then references unknown task 'wholly-unrelated-target'",
    ]);
  });

  it("checks llm_call/validate fallback_task and agent_call output.fallback_task", () => {
    const errors = validateCrossTaskReferences(
      spec([
        {
          name: "llm",
          kind: WorkflowTaskKind.llm_call,
          taskConfig: { model: "m", prompt: "p", fallback_task: "nope" },
        },
        {
          name: "val",
          kind: WorkflowTaskKind.validate,
          taskConfig: { input: "${ . }", fallbackTask: "nope" },
        },
        {
          name: "agent",
          kind: WorkflowTaskKind.agent_call,
          taskConfig: {
            agent: "a",
            message: "m",
            output: { fallback_task: "nope" },
          },
        },
      ]),
    );
    expect(errors).toEqual([
      "task 'llm' (llm_call) fallback_task references unknown task 'nope'",
      "task 'val' (validate) fallback_task references unknown task 'nope'",
      "task 'agent' (agent_call) output.fallback_task references unknown task 'nope'",
    ]);
  });

  it("checks switch cases[].then and human_input outcomes[].then with end allowed", () => {
    const errors = validateCrossTaskReferences(
      spec([
        {
          name: "sw",
          kind: WorkflowTaskKind.switch_case,
          taskConfig: {
            cases: [{ then: "missing" }, { then: "end" }],
          },
        },
        {
          name: "gate",
          kind: WorkflowTaskKind.human_input,
          taskConfig: {
            prompt: "p",
            outcomes: [{ name: "ok", then: "alsoMissing" }, { name: "no", then: "end" }],
          },
        },
      ]),
    );
    expect(errors).toEqual([
      "task 'sw' (switch_case) cases[0].then references unknown task 'missing'",
      "task 'gate' (human_input) outcomes[0].then references unknown task 'alsoMissing'",
    ]);
  });

  it("detects flow.then cycles", () => {
    const errors = validateCrossTaskReferences(
      spec([SET("a", "b"), SET("b", "a")]),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^circular dependency detected: (a -> b -> a|b -> a -> b)$/);
  });

  it("accepts an acyclic graph terminating in end", () => {
    expect(
      validateCrossTaskReferences(spec([SET("a", "b"), SET("b", "end")])),
    ).toEqual([]);
  });
});

describe("validateTaskConfigSurfaceRules", () => {
  it("refuses non-git_repo workspace sources on agent_call, skips absent sources", () => {
    const errors = validateTaskConfigSurfaceRules(
      spec([
        {
          name: "call",
          kind: WorkflowTaskKind.agent_call,
          taskConfig: {
            agent: "a",
            message: "m",
            workspace_entries: [
              { name: "ok", source: { git_repo: { url: "https://x.test/r" } } },
              { name: "local", source: { local_path: { path: "/tmp" } } },
              { name: "absent" },
            ],
          },
        },
      ]),
    );
    expect(errors).toEqual([
      "task 'call' (agent_call): workspace_entries[1] must use a git_repo source — no client is connected to serve a local_path when a workflow task fires",
    ]);
  });

  it("refuses a run_workflow task, input or not", () => {
    const errors = validateTaskConfigSurfaceRules(
      spec([
        {
          name: "child",
          kind: WorkflowTaskKind.run_workflow,
          taskConfig: { workflow: "data-enrichment", input: { user_id: "u1" } },
        },
        {
          name: "bare",
          kind: WorkflowTaskKind.run_workflow,
          taskConfig: { workflow: "stigmer/workflow/execute" },
        },
      ]),
    );
    expect(errors).toEqual([
      "task 'child' (run_workflow): running a child workflow is not supported yet — the child name cannot be resolved to a workflow the platform can run",
      "task 'bare' (run_workflow): running a child workflow is not supported yet — the child name cannot be resolved to a workflow the platform can run",
    ]);
  });

  // A rule that only saw top-level tasks could be stepped around by
  // wrapping the task in a for_each; the walk and its order are the
  // constraint validator's.
  it("reaches for_each do blocks, fork branches, try/catch and compensate lists in declaration order", () => {
    const runChild = (name: string) => ({
      name,
      kind: "run_workflow",
      task_config: { workflow: "child" },
    });
    const errors = validateTaskConfigSurfaceRules(
      create(WorkflowSpecSchema, {
        document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
        tasks: [
          {
            name: "loop",
            kind: WorkflowTaskKind.for_each,
            taskConfig: {
              in: "${ .items }",
              each: "item",
              do: [
                runChild("in_loop"),
                {
                  name: "local_call",
                  kind: "agent_call",
                  task_config: {
                    agent: "a",
                    message: "m",
                    workspace_entries: [
                      { name: "local", source: { local_path: { path: "/tmp" } } },
                    ],
                  },
                },
              ],
            },
          },
          {
            name: "par",
            kind: WorkflowTaskKind.fork,
            taskConfig: {
              branches: [
                { name: "a", do: [runChild("in_branch")] },
                { name: "b", do: [SET_JSON("noop")] },
              ],
            },
          },
          {
            name: "guard",
            kind: WorkflowTaskKind.try_catch,
            taskConfig: {
              try: [runChild("in_try")],
              catch: { do: [runChild("in_catch")] },
            },
          },
          {
            name: "top",
            kind: WorkflowTaskKind.set_vars,
            taskConfig: { variables: { k: "v" } },
            compensate: [
              {
                name: "in_compensate",
                kind: WorkflowTaskKind.run_workflow,
                taskConfig: { workflow: "child" },
              },
            ],
          },
        ],
      }),
    );
    expect(errors.map((e) => /task '([^']+)'/.exec(e)?.[1])).toEqual([
      "in_loop",
      "local_call",
      "in_branch",
      "in_try",
      "in_catch",
      "in_compensate",
    ]);
    expect(errors[1]).toBe(
      "task 'local_call' (agent_call): workspace_entries[0] must use a git_repo source — no client is connected to serve a local_path when a workflow task fires",
    );
  });

  it("skips a control-flow task whose config cannot be unmarshaled (the conversion step reports it)", () => {
    expect(
      validateTaskConfigSurfaceRules(
        spec([
          {
            name: "loop",
            kind: WorkflowTaskKind.for_each,
            taskConfig: { not_a_field: true },
          },
        ]),
      ),
    ).toEqual([]);
  });
});

function SET_JSON(name: string): JsonObject {
  return { name, kind: "set_vars", task_config: { variables: { k: "v" } } };
}
