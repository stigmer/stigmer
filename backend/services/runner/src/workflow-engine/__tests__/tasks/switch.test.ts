import { describe, it, expect } from "vitest";
import { SwitchTaskBuilder, extractFlowDirective } from "../../tasks/switch.js";
import { createState } from "../../state.js";
import { evaluateExpressionBatch } from "../../expression.js";
import type { SwitchTaskDef, TaskExecutionContext } from "../../types.js";

const notAvailable = () => { throw new Error("not available in test"); };

function makeCtx(): TaskExecutionContext {
  return {
    evaluateExpressions: evaluateExpressionBatch,
    doc: { document: { dsl: "1.0.0", name: "test" }, do: [] },
    sleep: notAvailable,
    listen: notAvailable,
    runCommand: notAvailable,
    runWorkflow: notAvailable,
    awaitHumanInput: notAvailable,
    callHttp: notAvailable,
    callGrpc: notAvailable,
    callFunction: notAvailable,
    callAgent: notAvailable,
  };
}

describe("SwitchTaskBuilder", () => {
  it("matches the first true condition", async () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "highValue", when: "${ $context.userId > 5 }", then: "highValueUser" },
        { name: "regular", when: "${ $context.userId <= 5 }", then: "regularUser" },
        { name: "default", then: "unknownUser" },
      ],
    };
    const builder = new SwitchTaskBuilder("classifyUser", taskDef);
    const executor = builder.build();
    const state = createState();
    state.context = { userId: 10 };

    const output = await executor(null, state, makeCtx());
    const directive = extractFlowDirective(output);

    expect(directive).toBe("highValueUser");
  });

  it("falls through to second condition when first is false", async () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "highValue", when: "${ $context.userId > 5 }", then: "highValueUser" },
        { name: "regular", when: "${ $context.userId <= 5 }", then: "regularUser" },
      ],
    };
    const builder = new SwitchTaskBuilder("classifyUser", taskDef);
    const executor = builder.build();
    const state = createState();
    state.context = { userId: 3 };

    const output = await executor(null, state, makeCtx());
    const directive = extractFlowDirective(output);

    expect(directive).toBe("regularUser");
  });

  it("matches the default case when no when conditions match", async () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "never", when: "${ 1 == 0 }", then: "neverReached" },
        { name: "default", then: "fallback" },
      ],
    };
    const builder = new SwitchTaskBuilder("decide", taskDef);
    const executor = builder.build();
    const state = createState();

    const output = await executor(null, state, makeCtx());
    const directive = extractFlowDirective(output);

    expect(directive).toBe("fallback");
  });

  it("supports end directive", async () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "always", when: "${ 1 == 1 }", then: "end" },
      ],
    };
    const builder = new SwitchTaskBuilder("decide", taskDef);
    const executor = builder.build();
    const state = createState();

    const output = await executor(null, state, makeCtx());
    const directive = extractFlowDirective(output);

    expect(directive).toBe("end");
  });

  it("returns null when no conditions match and no default", async () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "never", when: "${ 1 == 0 }", then: "neverReached" },
      ],
    };
    const builder = new SwitchTaskBuilder("decide", taskDef);
    const executor = builder.build();
    const state = createState();

    const output = await executor(null, state, makeCtx());

    expect(output).toBeNull();
  });

  it("throws on duplicate default cases", () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "default1", then: "a" },
        { name: "default2", then: "b" },
      ],
    };
    expect(() => new SwitchTaskBuilder("bad", taskDef)).toThrow(
      "has 2 default cases",
    );
  });

  it("uses $data variables for conditions", async () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "valid", when: "${ $data.valid == true }", then: "proceed" },
        { name: "default", then: "reject" },
      ],
    };
    const builder = new SwitchTaskBuilder("check", taskDef);
    const executor = builder.build();
    const state = createState();
    state.addData({ valid: true });

    const output = await executor(null, state, makeCtx());
    const directive = extractFlowDirective(output);

    expect(directive).toBe("proceed");
  });

  it("matches golden YAML 02 — classify user by userId", async () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "highValueCase", when: "${ $context.userId > 5 }", then: "highValueUser" },
        { name: "regularUserCase", when: "${ $context.userId <= 5 }", then: "regularUser" },
        { name: "defaultCase", then: "unknownUser" },
      ],
    };
    const builder = new SwitchTaskBuilder("classifyUser", taskDef);
    const executor = builder.build();

    const state1 = createState();
    state1.context = { userId: 7 };
    const output1 = await executor(null, state1, makeCtx());
    expect(extractFlowDirective(output1)).toBe("highValueUser");

    const state2 = createState();
    state2.context = { userId: 3 };
    const output2 = await executor(null, state2, makeCtx());
    expect(extractFlowDirective(output2)).toBe("regularUser");
  });

  it("matches single-quoted string condition — the approval gate pattern", async () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "approved", when: "${ $context.review.outcome == 'approve' }", then: "handleApproved" },
        { name: "rejected", then: "handleRejected" },
      ],
    };
    const builder = new SwitchTaskBuilder("approvalGate", taskDef);
    const executor = builder.build();
    const state = createState();
    state.context = { review: { outcome: "approve", reviewer: "alice" } };

    const output = await executor(null, state, makeCtx());
    expect(extractFlowDirective(output)).toBe("handleApproved");
  });

  it("matches double-quoted string condition (baseline parity)", async () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "approved", when: '${ $context.review.outcome == "approve" }', then: "handleApproved" },
        { name: "rejected", then: "handleRejected" },
      ],
    };
    const builder = new SwitchTaskBuilder("approvalGate", taskDef);
    const executor = builder.build();
    const state = createState();
    state.context = { review: { outcome: "approve" } };

    const output = await executor(null, state, makeCtx());
    expect(extractFlowDirective(output)).toBe("handleApproved");
  });

  it("falls through to default when single-quoted condition does not match", async () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "approved", when: "${ $context.review.outcome == 'approve' }", then: "handleApproved" },
        { name: "rejected", then: "handleRejected" },
      ],
    };
    const builder = new SwitchTaskBuilder("approvalGate", taskDef);
    const executor = builder.build();
    const state = createState();
    state.context = { review: { outcome: "reject" } };

    const output = await executor(null, state, makeCtx());
    expect(extractFlowDirective(output)).toBe("handleRejected");
  });

  it("routes 3-way string switch correctly", async () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "approve", when: "${ $context.gate.outcome == 'approve' }", then: "approved" },
        { name: "escalate", when: "${ $context.gate.outcome == 'escalate' }", then: "escalated" },
        { name: "reject", when: "${ $context.gate.outcome == 'reject' }", then: "rejected" },
        { name: "default", then: "unknown" },
      ],
    };
    const builder = new SwitchTaskBuilder("threeWay", taskDef);
    const executor = builder.build();

    for (const [outcome, expected] of [
      ["approve", "approved"],
      ["escalate", "escalated"],
      ["reject", "rejected"],
      ["other", "unknown"],
    ]) {
      const state = createState();
      state.context = { gate: { outcome } };
      const output = await executor(null, state, makeCtx());
      expect(extractFlowDirective(output)).toBe(expected);
    }
  });

  it("accesses deeply nested context in single-quoted condition", async () => {
    const taskDef: SwitchTaskDef = {
      kind: "switch",
      switch: [
        { name: "critical", when: "${ $context.classify.result.severity == 'critical' }", then: "escalate" },
        { name: "default", then: "log" },
      ],
    };
    const builder = new SwitchTaskBuilder("severity", taskDef);
    const executor = builder.build();
    const state = createState();
    state.context = { classify: { result: { severity: "critical" } } };

    const output = await executor(null, state, makeCtx());
    expect(extractFlowDirective(output)).toBe("escalate");
  });
});

describe("extractFlowDirective", () => {
  it("extracts directive from switch output", () => {
    expect(extractFlowDirective({ __flow_directive__: "end" })).toBe("end");
    expect(extractFlowDirective({ __flow_directive__: "myTask" })).toBe("myTask");
  });

  it("returns undefined for non-switch output", () => {
    expect(extractFlowDirective(null)).toBeUndefined();
    expect(extractFlowDirective(42)).toBeUndefined();
    expect(extractFlowDirective({ data: 1 })).toBeUndefined();
  });
});
