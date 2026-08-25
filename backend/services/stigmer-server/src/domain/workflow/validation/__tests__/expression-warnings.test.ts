/**
 * Expression-warning tests — pin the Go expression_warnings.go scanning:
 * key extraction from $context.env.* references (multiple per string,
 * nested structures and lists, key-charset termination) and the pinned
 * warning copy.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";

import { checkExpressionWarnings } from "../expression-warnings.js";

describe("checkExpressionWarnings", () => {
  it("extracts keys from nested structures, lists, and multi-hit strings", () => {
    const spec = create(WorkflowSpecSchema, {
      document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
      tasks: [
        {
          name: "t",
          kind: WorkflowTaskKind.set_vars,
          taskConfig: {
            variables: {
              a: "${ $context.env.FIRST } and ${ $context.env.SECOND }",
            },
            nested: { deep: ["${ $context.env.IN_LIST }..."] },
          },
        },
      ],
    });

    const warnings = checkExpressionWarnings(spec);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toBe(
      "task 't': expression references '$context.env.FIRST' which resolves to null. " +
        "Environment variables are accessed via '$env.FIRST', not '$context.env.FIRST'. " +
        "$context holds accumulated task outputs, not environment variables.",
    );
    expect(warnings[1]).toContain("SECOND");
    expect(warnings[2]).toContain("IN_LIST");
  });

  it("terminates keys at non-identifier characters and skips bare prefixes", () => {
    const spec = create(WorkflowSpecSchema, {
      document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
      tasks: [
        {
          name: "t",
          kind: WorkflowTaskKind.set_vars,
          taskConfig: {
            variables: {
              a: "${ $context.env.MY_KEY_2 | ascii }",
              // The prefix with no key following extracts nothing.
              b: "$context.env.",
            },
          },
        },
      ],
    });

    const warnings = checkExpressionWarnings(spec);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'$env.MY_KEY_2'");
  });

  it("stays quiet for correct $env usage and config-less tasks", () => {
    const spec = create(WorkflowSpecSchema, {
      document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
      tasks: [
        {
          name: "ok",
          kind: WorkflowTaskKind.set_vars,
          taskConfig: { variables: { a: "${ $env.GOOD }" } },
        },
        { name: "bare", kind: WorkflowTaskKind.wait },
      ],
    });
    expect(checkExpressionWarnings(spec)).toEqual([]);
  });
});
