import { describe, it, expect } from "vitest";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { categorizeKind, kindToDisplayName } from "../kind-metadata";

const ALL_KIND_STRINGS = Object.entries(WorkflowTaskKind)
  .filter(
    ([, v]) =>
      typeof v === "number" &&
      v !== WorkflowTaskKind.workflow_task_kind_unspecified,
  )
  .map(([name]) => name);

describe("categorizeKind", () => {
  it("maps every WorkflowTaskKind to a non-unspecified category", () => {
    for (const kind of ALL_KIND_STRINGS) {
      const category = categorizeKind(kind);
      expect(category, `${kind} should have a category`).not.toBe(
        "unspecified",
      );
    }
  });

  it("returns unspecified for unknown kinds", () => {
    expect(categorizeKind("nonexistent_kind")).toBe("unspecified");
    expect(categorizeKind("")).toBe("unspecified");
  });

  it("classifies validate as data (not governance)", () => {
    expect(categorizeKind("validate")).toBe("data");
  });

  it("classifies wait as control_flow (not event)", () => {
    expect(categorizeKind("wait")).toBe("control_flow");
  });

  it("classifies ai kinds correctly", () => {
    expect(categorizeKind("agent_call")).toBe("ai");
    expect(categorizeKind("llm_call")).toBe("ai");
    expect(categorizeKind("eval")).toBe("ai");
  });

  it("classifies control_flow kinds correctly", () => {
    expect(categorizeKind("switch_case")).toBe("control_flow");
    expect(categorizeKind("for_each")).toBe("control_flow");
    expect(categorizeKind("fork")).toBe("control_flow");
    expect(categorizeKind("try_catch")).toBe("control_flow");
  });

  it("classifies invocation kinds correctly", () => {
    expect(categorizeKind("http_call")).toBe("invocation");
    expect(categorizeKind("grpc_call")).toBe("invocation");
    expect(categorizeKind("activity_call")).toBe("invocation");
    expect(categorizeKind("run_workflow")).toBe("invocation");
  });

  it("classifies data kinds correctly", () => {
    expect(categorizeKind("set_vars")).toBe("data");
    expect(categorizeKind("transform")).toBe("data");
  });

  it("classifies governance kinds correctly", () => {
    expect(categorizeKind("human_input")).toBe("governance");
  });

  it("classifies event kinds correctly", () => {
    expect(categorizeKind("listen")).toBe("event");
    expect(categorizeKind("emit_event")).toBe("event");
    expect(categorizeKind("notification")).toBe("event");
    expect(categorizeKind("raise_error")).toBe("event");
  });
});

describe("kindToDisplayName", () => {
  it("returns sidecar display names for all known kinds", () => {
    expect(kindToDisplayName("agent_call")).toBe("Agent Call");
    expect(kindToDisplayName("llm_call")).toBe("LLM Call");
    expect(kindToDisplayName("http_call")).toBe("HTTP Call");
    expect(kindToDisplayName("grpc_call")).toBe("gRPC Call");
    expect(kindToDisplayName("set_vars")).toBe("Set Variables");
    expect(kindToDisplayName("switch_case")).toBe("Switch Case");
    expect(kindToDisplayName("human_input")).toBe("Human Input");
    expect(kindToDisplayName("run_workflow")).toBe("Run Workflow");
    expect(kindToDisplayName("try_catch")).toBe("Try/Catch");
    expect(kindToDisplayName("eval")).toBe("Evaluate (LLM Judge)");
  });

  it("returns every known kind with a non-empty display name", () => {
    for (const kind of ALL_KIND_STRINGS) {
      const name = kindToDisplayName(kind);
      expect(name.length, `${kind} should have a non-empty display name`).toBeGreaterThan(0);
    }
  });

  it("returns title-cased fallback for unknown kinds", () => {
    expect(kindToDisplayName("my_custom_task")).toBe("My Custom Task");
    expect(kindToDisplayName("single")).toBe("Single");
  });
});
