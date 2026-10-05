/**
 * Pins the one walk over a workflow's agent_call steps
 * (validation/agent-call-steps.ts): it finds a step at every depth — a
 * for-each body, a fork branch, a try and its catch, and a compensate list
 * — in declaration order with the path a message names it by; save refuses
 * two agent_call steps of one name anywhere, naming both places, while
 * other task kinds may repeat a name across nested lists; and the lookup
 * an agent turn's keys are read through answers the first match in walk
 * order with how many steps share the name.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowSpec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { WorkflowSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

import {
  agentCallSteps,
  findAgentCallStep,
  validateUniqueAgentCallNames,
} from "../agent-call-steps.js";

function agentCall(name: string, env = "") {
  return {
    name,
    kind: WorkflowTaskKind.agent_call,
    taskConfig: {
      agent: "acme/reviewer",
      message: "review",
      ...(env === "" ? {} : { environment_refs: [{ org: "acme", slug: env }] }),
    },
  };
}

/** A nested task inside a Struct config is JSON: proto field names. */
function nestedAgentCall(name: string, env = "") {
  return {
    name,
    kind: "agent_call",
    task_config: {
      agent: "acme/reviewer",
      message: "review",
      ...(env === "" ? {} : { environment_refs: [{ org: "acme", slug: env }] }),
    },
  };
}

function specOf(tasks: ReadonlyArray<Record<string, unknown>>): WorkflowSpec {
  return create(WorkflowSpecSchema, { tasks } as never);
}

const NESTED = specOf([
  agentCall("top"),
  {
    name: "loop",
    kind: WorkflowTaskKind.for_each,
    taskConfig: {
      each: "item",
      in: "${ .items }",
      do: [nestedAgentCall("in-loop", "loop-env")],
    },
    compensate: [agentCall("undo")],
  },
  {
    name: "fan",
    kind: WorkflowTaskKind.fork,
    taskConfig: {
      branches: [
        { name: "a", do: [nestedAgentCall("branch-a")] },
        { name: "b", do: [nestedAgentCall("branch-b")] },
      ],
    },
  },
  {
    name: "guard",
    kind: WorkflowTaskKind.try_catch,
    taskConfig: {
      try: [nestedAgentCall("attempt")],
      catch: { as: "error", do: [nestedAgentCall("recover")] },
    },
  },
]);

describe("agentCallSteps", () => {
  it("finds every agent_call at every depth, in declaration order, with its path", () => {
    expect(
      agentCallSteps(NESTED).map((step) => [step.name, step.path]),
    ).toEqual([
      ["top", "top"],
      ["in-loop", "loop > in-loop"],
      ["undo", "loop > compensate > undo"],
      ["branch-a", "fan > branch-a"],
      ["branch-b", "fan > branch-b"],
      ["attempt", "guard > attempt"],
      ["recover", "guard > recover"],
    ]);
  });

  it("answers nothing for an absent spec", () => {
    expect(agentCallSteps(undefined)).toEqual([]);
  });
});

describe("validateUniqueAgentCallNames", () => {
  it("passes a workflow whose agent_call names are unique at every depth", () => {
    expect(validateUniqueAgentCallNames(NESTED)).toEqual([]);
  });

  it("refuses a nested agent_call that repeats a top-level one, naming both places", () => {
    const spec = specOf([
      agentCall("review"),
      {
        name: "loop",
        kind: WorkflowTaskKind.for_each,
        taskConfig: {
          each: "item",
          in: "${ .items }",
          do: [nestedAgentCall("review")],
        },
      },
    ]);
    expect(validateUniqueAgentCallNames(spec)).toEqual([
      'duplicate agent_call step name "review" at "loop > review": already used at "review" (an agent_call step\'s name must be unique across the whole workflow)',
    ]);
  });

  it("refuses a repeat inside a compensate list", () => {
    const spec = specOf([
      { ...agentCall("notify"), compensate: [agentCall("notify")] },
    ]);
    expect(validateUniqueAgentCallNames(spec)).toHaveLength(1);
  });

  it("leaves an unnamed step to the validator that refuses it", () => {
    const spec = specOf([agentCall(""), agentCall("")]);
    expect(validateUniqueAgentCallNames(spec)).toEqual([]);
  });

  it("lets other task kinds repeat a name across nested lists", () => {
    const spec = specOf([
      agentCall("review"),
      {
        name: "loop",
        kind: WorkflowTaskKind.for_each,
        taskConfig: {
          each: "item",
          in: "${ .items }",
          do: [
            { name: "pause", kind: "wait", task_config: { duration: {} } },
          ],
        },
      },
      {
        name: "again",
        kind: WorkflowTaskKind.for_each,
        taskConfig: {
          each: "item",
          in: "${ .items }",
          do: [
            { name: "pause", kind: "wait", task_config: { duration: {} } },
          ],
        },
      },
    ]);
    expect(validateUniqueAgentCallNames(spec)).toEqual([]);
  });
});

describe("findAgentCallStep", () => {
  it("finds a nested step and its environment_refs", () => {
    const { step, matches } = findAgentCallStep(NESTED, "in-loop");
    expect(matches).toBe(1);
    expect(step?.config.environmentRefs.map((ref) => ref.slug)).toEqual([
      "loop-env",
    ]);
  });

  it("answers the first in walk order and the count when a version saved before the rule repeats a name", () => {
    const spec = specOf([
      agentCall("review", "first-env"),
      {
        name: "loop",
        kind: WorkflowTaskKind.for_each,
        taskConfig: {
          each: "item",
          in: "${ .items }",
          do: [nestedAgentCall("review", "second-env")],
        },
      },
    ]);
    const { step, matches } = findAgentCallStep(spec, "review");
    expect(matches).toBe(2);
    expect(step?.config.environmentRefs[0]?.slug).toBe("first-env");
  });

  it("answers no step for a name the version does not hold", () => {
    expect(findAgentCallStep(NESTED, "gone")).toEqual({
      step: undefined,
      matches: 0,
    });
  });
});
