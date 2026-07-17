// Unit tests for the headless task-presentation layer (T04): the built-in
// per-kind preview lines across all 20 task kinds, the status-line
// precedence, the disclosure taxonomy, defensive Struct parsing (summaries
// are runner-dependent — malformed shapes must degrade, never break), and
// the `registerTaskPresenter` override seam.

import { describe, it, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import {
  resolveTaskPreview,
  registerTaskPresenter,
  defaultDisclosureForKind,
  valueSnippet,
} from "../thread/task-presentation";

function state(
  overrides: Partial<DerivedTaskState> = {},
): DerivedTaskState {
  return {
    taskName: "task",
    taskKind: WorkflowTaskKind.set_vars,
    status: "completed",
    durationMs: 100,
    costMicros: 0n,
    tokensUsed: 0n,
    attemptNumber: 1,
    error: "",
    childExecutionId: "",
    agentSlug: "",
    currentToolName: "",
    messagesCount: 0,
    toolCallsCount: 0,
    inputSummary: null,
    outputSummary: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Status-line precedence (universal, kind-independent)
// ---------------------------------------------------------------------------

describe("status-line precedence", () => {
  it("waiting_approval outranks any kind line", () => {
    const { previewLine } = resolveTaskPreview(
      state({
        taskKind: WorkflowTaskKind.validate,
        status: "waiting_approval",
        outputSummary: { valid: false, errors: [{}] },
      }),
    );
    expect(previewLine).toBe("Awaiting approval");
  });

  it("a failure shows the error's first line", () => {
    const { previewLine } = resolveTaskPreview(
      state({
        taskKind: WorkflowTaskKind.validate,
        status: "failed",
        error: "[TypeError] expr.includes is not a function\nstack trace…",
      }),
    );
    expect(previewLine).toBe("[TypeError] expr.includes is not a function");
  });

  it("skipped shows Skipped", () => {
    const { previewLine } = resolveTaskPreview(state({ status: "skipped" }));
    expect(previewLine).toBe("Skipped");
  });

  it("caps the line length (bounded header, not a body)", () => {
    const { previewLine } = resolveTaskPreview(
      state({ status: "failed", error: "x".repeat(500) }),
    );
    expect(previewLine.length).toBeLessThanOrEqual(80);
    expect(previewLine.endsWith("…")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Built-in per-kind lines — the full 20-kind table
// ---------------------------------------------------------------------------

describe("per-kind preview lines", () => {
  it.each<{
    label: string;
    kind: WorkflowTaskKind;
    overrides: Partial<DerivedTaskState>;
    expected: string;
  }>([
    {
      label: "set_vars from nested variables map",
      kind: WorkflowTaskKind.set_vars,
      overrides: {
        inputSummary: { variables: { order_id: "o-1", total: "120" } },
      },
      expected: "set order_id, total",
    },
    {
      label: "set_vars from top-level resolved variables",
      kind: WorkflowTaskKind.set_vars,
      overrides: { inputSummary: { a: "1", b: "2", c: "3", d: "4", e: "5" } },
      expected: "set a, b, c +2 more",
    },
    {
      label: "transform with engine and scalar output",
      kind: WorkflowTaskKind.transform,
      overrides: {
        inputSummary: { engine: "JQ", expression: ".total" },
        outputSummary: { result: 42 },
      },
      expected: "jq → 42",
    },
    {
      label: "transform running (engine only, no output yet)",
      kind: WorkflowTaskKind.transform,
      overrides: { status: "running", inputSummary: { engine: "JSONATA" } },
      expected: "jsonata",
    },
    {
      label: "validate passing",
      kind: WorkflowTaskKind.validate,
      overrides: { outputSummary: { valid: true, errors: [] } },
      expected: "valid",
    },
    {
      label: "validate failing with error rows",
      kind: WorkflowTaskKind.validate,
      overrides: {
        outputSummary: { valid: false, errors: [{ rule: "r1" }, { rule: "r2" }, { rule: "r3" }] },
      },
      expected: "3 errors",
    },
    {
      label: "validate failing with one error (singular)",
      kind: WorkflowTaskKind.validate,
      overrides: { outputSummary: { valid: false, errors: [{ rule: "r1" }] } },
      expected: "1 error",
    },
    {
      label: "validate invalid without errors array",
      kind: WorkflowTaskKind.validate,
      overrides: { outputSummary: { valid: false } },
      expected: "invalid",
    },
    {
      label: "llm_call with model and text output",
      kind: WorkflowTaskKind.llm_call,
      overrides: {
        inputSummary: { model: "claude-sonnet" },
        outputSummary: { text: "The answer is 42." },
      },
      expected: 'claude-sonnet · "The answer is 42."',
    },
    {
      label: "eval passing with score",
      kind: WorkflowTaskKind.eval,
      overrides: { outputSummary: { pass: true, score: 0.82 } },
      expected: "pass · score 0.82",
    },
    {
      label: "eval failing without score",
      kind: WorkflowTaskKind.eval,
      overrides: { outputSummary: { pass: false } },
      expected: "fail",
    },
    {
      label: "emit_event settled (CloudEvents type from output)",
      kind: WorkflowTaskKind.emit_event,
      overrides: { outputSummary: { type: "stigmer.ticket.classified" } },
      expected: "emitted stigmer.ticket.classified",
    },
    {
      label: "emit_event running (configured type from input)",
      kind: WorkflowTaskKind.emit_event,
      overrides: {
        status: "running",
        inputSummary: { event: { type: "stigmer.ticket.classified" } },
      },
      expected: "emitting stigmer.ticket.classified",
    },
    {
      label: "notification delivered",
      kind: WorkflowTaskKind.notification,
      overrides: { outputSummary: { channel: "slack", delivered: true } },
      expected: "sent via slack",
    },
    {
      label: "notification delivery failed",
      kind: WorkflowTaskKind.notification,
      overrides: { outputSummary: { channel: "slack", delivered: false } },
      expected: "delivery failed",
    },
    {
      label: "human_input settled decision",
      kind: WorkflowTaskKind.human_input,
      overrides: { outputSummary: { outcome: "approve", reviewer: "suresh" } },
      expected: "approve · by suresh",
    },
    {
      label: "wait completed with structured duration",
      kind: WorkflowTaskKind.wait,
      overrides: { inputSummary: { duration: { seconds: 10 } } },
      expected: "waited 10.0s",
    },
    {
      label: "wait running",
      kind: WorkflowTaskKind.wait,
      overrides: {
        status: "running",
        inputSummary: { duration: { minutes: 1, seconds: 30 } },
      },
      expected: "waiting 1m 30s",
    },
    {
      label: "wait until an absolute timestamp",
      kind: WorkflowTaskKind.wait,
      overrides: { inputSummary: { until: "2026-07-17T00:00:00Z" } },
      expected: "waited until 2026-07-17T00:00:00Z",
    },
    {
      label: "listen running",
      kind: WorkflowTaskKind.listen,
      overrides: { status: "running" },
      expected: "waiting for signal",
    },
    {
      label: "listen settled",
      kind: WorkflowTaskKind.listen,
      overrides: { status: "completed" },
      expected: "signal received",
    },
    {
      label: "agent_call running with live activity",
      kind: WorkflowTaskKind.agent_call,
      overrides: {
        status: "running",
        agentSlug: "blog-writer",
        currentToolName: "web_search",
        messagesCount: 7,
        toolCallsCount: 3,
      },
      expected: "blog-writer · running web_search · 7 msgs · 3 tools",
    },
    {
      label: "agent_call settled",
      kind: WorkflowTaskKind.agent_call,
      overrides: { agentSlug: "blog-writer", messagesCount: 12, toolCallsCount: 5 },
      expected: "blog-writer · 12 msgs · 5 tools",
    },
  ])("$label", ({ kind, overrides, expected }) => {
    const { previewLine } = resolveTaskPreview(state({ taskKind: kind, ...overrides }));
    expect(previewLine).toBe(expected);
  });

  // Kinds that deliberately stay status-only: control flow (branch/fork
  // detail needs graph topology the thread lacks — deferred), raise_error
  // (the failure precedence carries the message), the invocation kinds
  // (no verified output envelope — backend follow-up), and unspecified
  // (the snapshot fallback).
  it.each([
    WorkflowTaskKind.switch_case,
    WorkflowTaskKind.for_each,
    WorkflowTaskKind.fork,
    WorkflowTaskKind.try_catch,
    WorkflowTaskKind.raise_error,
    WorkflowTaskKind.http_call,
    WorkflowTaskKind.grpc_call,
    WorkflowTaskKind.activity_call,
    WorkflowTaskKind.run_workflow,
    WorkflowTaskKind.workflow_task_kind_unspecified,
  ])("kind %d yields an empty line when completed cleanly", (kind) => {
    const { previewLine } = resolveTaskPreview(
      state({ taskKind: kind, outputSummary: { some: "data" } }),
    );
    expect(previewLine).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Defensive parsing — summaries are runner-dependent; never break
// ---------------------------------------------------------------------------

describe("defensive Struct parsing", () => {
  it.each<{ label: string; kind: WorkflowTaskKind; input: JsonObject | null; output: JsonObject | null }>([
    { label: "absent summaries", kind: WorkflowTaskKind.validate, input: null, output: null },
    { label: "empty objects", kind: WorkflowTaskKind.set_vars, input: {}, output: {} },
    {
      label: "wrong-typed fields",
      kind: WorkflowTaskKind.validate,
      input: { variables: "not-an-object" },
      output: { valid: "yes", errors: "none" },
    },
    {
      label: "eval with non-boolean pass",
      kind: WorkflowTaskKind.eval,
      input: null,
      output: { pass: "true", score: "high" },
    },
    {
      label: "wait with unknown duration shape",
      kind: WorkflowTaskKind.wait,
      input: { duration: { fortnights: 2 } },
      output: null,
    },
    {
      label: "wait with non-numeric duration values",
      kind: WorkflowTaskKind.wait,
      input: { duration: { seconds: "ten" } },
      output: null,
    },
  ])("degrades to empty on $label", ({ kind, input, output }) => {
    const { previewLine } = resolveTaskPreview(
      state({ taskKind: kind, inputSummary: input, outputSummary: output }),
    );
    expect(previewLine).toBe("");
  });

  it("handles an oversized variables map without an oversized line", () => {
    const vars: Record<string, string> = {};
    for (let i = 0; i < 100; i++) vars[`variable_number_${i}`] = "v";
    const { previewLine } = resolveTaskPreview(
      state({ taskKind: WorkflowTaskKind.set_vars, inputSummary: { variables: vars } }),
    );
    expect(previewLine.length).toBeLessThanOrEqual(80);
    expect(previewLine.startsWith("set ")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// valueSnippet
// ---------------------------------------------------------------------------

describe("valueSnippet", () => {
  it.each<[JsonValueLike, string]>([
    [null, "null"],
    [42, "42"],
    [true, "true"],
    ["hello", '"hello"'],
    ["line1\nline2", '"line1"'],
    [[1, 2, 3], "[3 items]"],
    [[1], "[1 item]"],
    [{ a: 1, b: 2 }, "{2 fields}"],
    // A single-field envelope unwraps to its scalar payload.
    [{ result: 42 }, "42"],
    [{ result: { nested: true } }, "{1 field}"],
  ])("snippets %j as %s", (value, expected) => {
    expect(valueSnippet(value)).toBe(expected);
  });
});

type JsonValueLike = Parameters<typeof valueSnippet>[0];

// ---------------------------------------------------------------------------
// Disclosure taxonomy
// ---------------------------------------------------------------------------

describe("defaultDisclosureForKind", () => {
  // T05 (DD-T05-5): every kind whose output CAN matter is a preview kind —
  // the showBody gate keeps output-less cards as one-line rows, so preview
  // disclosure costs nothing until the runner writes real output. Only
  // genuinely body-less kinds (control flow, wait/listen, unspecified)
  // remain summary.
  it.each([
    [WorkflowTaskKind.transform, "preview"],
    [WorkflowTaskKind.validate, "preview"],
    [WorkflowTaskKind.llm_call, "preview"],
    [WorkflowTaskKind.eval, "preview"],
    [WorkflowTaskKind.emit_event, "preview"],
    [WorkflowTaskKind.notification, "preview"],
    [WorkflowTaskKind.agent_call, "preview"],
    [WorkflowTaskKind.set_vars, "preview"],
    [WorkflowTaskKind.human_input, "preview"],
    [WorkflowTaskKind.http_call, "preview"],
    [WorkflowTaskKind.grpc_call, "preview"],
    [WorkflowTaskKind.activity_call, "preview"],
    [WorkflowTaskKind.run_workflow, "preview"],
    [WorkflowTaskKind.wait, "summary"],
    [WorkflowTaskKind.switch_case, "summary"],
    [WorkflowTaskKind.fork, "summary"],
    [WorkflowTaskKind.try_catch, "summary"],
    [WorkflowTaskKind.for_each, "summary"],
    [WorkflowTaskKind.listen, "summary"],
    [WorkflowTaskKind.raise_error, "summary"],
    [WorkflowTaskKind.workflow_task_kind_unspecified, "summary"],
  ] as const)("kind %d defaults to %s", (kind, expected) => {
    expect(defaultDisclosureForKind(kind)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Presenter registry (the platform-builder seam)
// ---------------------------------------------------------------------------

describe("registerTaskPresenter", () => {
  it("overrides the kind line and restores the previous presenter on dispose", () => {
    const dispose = registerTaskPresenter(WorkflowTaskKind.validate, {
      previewLine: () => "custom check line",
    });
    try {
      const withOverride = resolveTaskPreview(
        state({ taskKind: WorkflowTaskKind.validate, outputSummary: { valid: true } }),
      );
      expect(withOverride.previewLine).toBe("custom check line");
    } finally {
      dispose();
    }
    const restored = resolveTaskPreview(
      state({ taskKind: WorkflowTaskKind.validate, outputSummary: { valid: true } }),
    );
    expect(restored.previewLine).toBe("valid");
  });

  it("falls back to the built-in line when the override returns null", () => {
    const dispose = registerTaskPresenter(WorkflowTaskKind.validate, {
      previewLine: () => null,
    });
    try {
      const { previewLine } = resolveTaskPreview(
        state({ taskKind: WorkflowTaskKind.validate, outputSummary: { valid: true } }),
      );
      expect(previewLine).toBe("valid");
    } finally {
      dispose();
    }
  });

  it("never lets an override outrank status lines (correctness surface)", () => {
    const dispose = registerTaskPresenter(WorkflowTaskKind.validate, {
      previewLine: () => "should not appear",
    });
    try {
      const { previewLine } = resolveTaskPreview(
        state({ taskKind: WorkflowTaskKind.validate, status: "waiting_approval" }),
      );
      expect(previewLine).toBe("Awaiting approval");
    } finally {
      dispose();
    }
  });

  it("can override disclosure per kind", () => {
    const dispose = registerTaskPresenter(WorkflowTaskKind.http_call, {
      disclosure: () => "preview",
    });
    try {
      const { disclosure } = resolveTaskPreview(
        state({ taskKind: WorkflowTaskKind.http_call }),
      );
      expect(disclosure).toBe("preview");
    } finally {
      dispose();
    }
  });

  it("restores a PREVIOUS override (not just the default) on dispose", () => {
    const disposeA = registerTaskPresenter(WorkflowTaskKind.validate, {
      previewLine: () => "A",
    });
    const disposeB = registerTaskPresenter(WorkflowTaskKind.validate, {
      previewLine: () => "B",
    });
    try {
      expect(
        resolveTaskPreview(state({ taskKind: WorkflowTaskKind.validate })).previewLine,
      ).toBe("B");
      disposeB();
      expect(
        resolveTaskPreview(state({ taskKind: WorkflowTaskKind.validate })).previewLine,
      ).toBe("A");
    } finally {
      disposeA();
    }
  });
});
