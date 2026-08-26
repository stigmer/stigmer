/**
 * Constraint-walker tests (stigmer#805) — the highest-stakes pin in this
 * package: the exact violation string the conformance suite asserts on
 * every edition ("the exact-string assertion IS the lockstep
 * verification"). If protovalidate-es renders a different message than
 * protovalidate-go for these arms, THIS file fails before the conformance
 * gate does, and the divergence goes to the owner (the #4 watch item).
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import {
  WorkflowSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

import { validateTaskConfigConstraints } from "../task-config-constraints.js";

describe("validateTaskConfigConstraints", () => {
  it("renders wait's duration.non_zero violation with the byte-lockstep string (#805)", () => {
    const spec = create(WorkflowSpecSchema, {
      document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
      tasks: [
        {
          name: "conditional_wait",
          kind: WorkflowTaskKind.wait,
          taskConfig: { duration: {} },
        },
      ],
    });

    const violations = validateTaskConfigConstraints(spec);

    // The exact string the conformance suite pins cross-edition.
    expect(violations).toContain(
      "task 'conditional_wait' (wait): duration \u2013 at least one duration field must be non-zero",
    );
  });

  it("passes a valid config and an absent duration (the oneof is not required)", () => {
    const spec = create(WorkflowSpecSchema, {
      document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
      tasks: [
        { name: "w1", kind: WorkflowTaskKind.wait, taskConfig: {} },
        {
          name: "w2",
          kind: WorkflowTaskKind.wait,
          taskConfig: { duration: { seconds: 5 } },
        },
      ],
    });

    expect(validateTaskConfigConstraints(spec)).toEqual([]);
  });

  it("recurses into for_each do blocks, fork branches, try/catch, and compensate lists in declaration order", () => {
    const badWait = { duration: {} };
    const spec = create(WorkflowSpecSchema, {
      document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
      tasks: [
        {
          name: "loop",
          kind: WorkflowTaskKind.for_each,
          taskConfig: {
            in: "${ .items }",
            do: [{ name: "nested_wait", kind: "wait", task_config: badWait }],
          },
        },
        {
          name: "par",
          kind: WorkflowTaskKind.fork,
          taskConfig: {
            branches: [
              {
                name: "b",
                do: [{ name: "branch_wait", kind: "wait", task_config: badWait }],
              },
            ],
          },
        },
        {
          name: "guard",
          kind: WorkflowTaskKind.try_catch,
          taskConfig: {
            try: [{ name: "try_wait", kind: "wait", task_config: badWait }],
            catch: {
              do: [{ name: "catch_wait", kind: "wait", task_config: badWait }],
            },
          },
        },
        {
          name: "top",
          kind: WorkflowTaskKind.set_vars,
          taskConfig: { variables: { k: "v" } },
          compensate: [
            { name: "comp_wait", kind: WorkflowTaskKind.wait, taskConfig: badWait },
          ],
        },
      ],
    });

    const violations = validateTaskConfigConstraints(spec);
    // The fixtures also trip declared rules on the parents themselves
    // (for_each requires `each`; fork requires ≥2 branches) — verified
    // against Go: same strings, same walker order (own violations first,
    // then nested in declaration order, then compensate).
    expect(violations.map((v) => /task '([^']+)'/.exec(v)?.[1])).toEqual([
      "loop",
      "nested_wait",
      "par",
      "branch_wait",
      "try_wait",
      "catch_wait",
      "comp_wait",
    ]);
    expect(violations).toContain(
      "task 'loop' (for_each): each \u2013 value is required",
    );
    expect(violations).toContain(
      "task 'par' (fork): branches \u2013 must contain at least 2 item(s)",
    );
  });

  it("never double-reports an unmarshal failure (the conversion step owns it)", () => {
    const spec = create(WorkflowSpecSchema, {
      document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
      tasks: [
        {
          name: "broken",
          kind: WorkflowTaskKind.wait,
          taskConfig: { not_a_field: true },
        },
      ],
    });

    expect(validateTaskConfigConstraints(spec)).toEqual([]);
  });

  it("returns nothing for an empty spec", () => {
    expect(validateTaskConfigConstraints(undefined)).toEqual([]);
    expect(
      validateTaskConfigConstraints(
        create(WorkflowSpecSchema, {
          document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
        }),
      ),
    ).toEqual([]);
  });
});
