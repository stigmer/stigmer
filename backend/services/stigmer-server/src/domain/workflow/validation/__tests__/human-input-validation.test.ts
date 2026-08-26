/**
 * Human-input timeout-policy tests — pin the Go human_input_validation.go
 * shapes (oss#781): the escalate policy requires an outcome literally named
 * "escalate" with `then` set; the policy is matched by enum NAME or NUMBER
 * (protojson accepts both spellings); other policies need no shape.
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { WorkflowSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { HumanInputTimeoutPolicy } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/human_input_pb";

import { validateHumanInputTimeoutPolicies } from "../human-input-validation.js";

function gate(taskConfig: JsonObject) {
  return create(WorkflowSpecSchema, {
    document: { dsl: "1.0.0", namespace: "t", name: "t", version: "0.1.0" },
    tasks: [{ name: "gate", kind: WorkflowTaskKind.human_input, taskConfig }],
  });
}

const PINNED_ERROR =
  "task 'gate' (human_input): on_timeout policy HUMAN_INPUT_TIMEOUT_ESCALATE requires an outcome named 'escalate' with 'then' set — the timeout resolves to that outcome and follows its 'then' branch";

describe("validateHumanInputTimeoutPolicies", () => {
  it("fails closed when escalate has no matching outcome (by name and by number)", () => {
    const byName = gate({
      prompt: "p",
      on_timeout: "HUMAN_INPUT_TIMEOUT_ESCALATE",
      outcomes: [{ name: "approve", then: "end" }],
    });
    expect(validateHumanInputTimeoutPolicies(byName)).toEqual([PINNED_ERROR]);

    const byNumber = gate({
      prompt: "p",
      on_timeout: HumanInputTimeoutPolicy.HUMAN_INPUT_TIMEOUT_ESCALATE,
      outcomes: [{ name: "escalate" }], // present but then-less
    });
    expect(validateHumanInputTimeoutPolicies(byNumber)).toEqual([PINNED_ERROR]);
  });

  it("passes when the escalate outcome exists with then set", () => {
    const ok = gate({
      prompt: "p",
      on_timeout: "HUMAN_INPUT_TIMEOUT_ESCALATE",
      outcomes: [{ name: "escalate", then: "review" }],
    });
    expect(validateHumanInputTimeoutPolicies(ok)).toEqual([]);
  });

  it("ignores non-escalate policies and absent on_timeout", () => {
    expect(
      validateHumanInputTimeoutPolicies(
        gate({ prompt: "p", on_timeout: "HUMAN_INPUT_TIMEOUT_FAIL" }),
      ),
    ).toEqual([]);
    expect(validateHumanInputTimeoutPolicies(gate({ prompt: "p" }))).toEqual([]);
  });
});
