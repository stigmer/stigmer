import { describe, it, expect } from "vitest";
import { getSuggestedKinds } from "../suggestions";
import type { InsertionContext } from "../insertion-context";

describe("getSuggestedKinds", () => {
  it("returns suggestions based on source kind for edge-splice mode", () => {
    const context: InsertionContext = {
      mode: "edge-splice",
      sourceKind: "http_call",
      sourceNodeId: "http_call_1",
    };

    const suggestions = getSuggestedKinds(context);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(5);

    const kinds = suggestions.map((s) => s.kind);
    expect(kinds).toContain("validate");
    expect(kinds).toContain("transform");
  });

  it("returns suggestions based on source kind for append-after mode", () => {
    const context: InsertionContext = {
      mode: "append-after",
      sourceKind: "llm_call",
      sourceNodeId: "llm_call_1",
    };

    const suggestions = getSuggestedKinds(context);
    const kinds = suggestions.map((s) => s.kind);
    expect(kinds).toContain("eval");
    expect(kinds).toContain("switch_case");
  });

  it("returns branch-specific suggestions for add-switch-case", () => {
    const context: InsertionContext = {
      mode: "add-switch-case",
      sourceNodeId: "classify_user",
    };

    const suggestions = getSuggestedKinds(context);
    const kinds = suggestions.map((s) => s.kind);
    expect(kinds).toContain("agent_call");
    expect(kinds).toContain("http_call");
  });

  it("returns branch-specific suggestions for add-fork-branch", () => {
    const context: InsertionContext = {
      mode: "add-fork-branch",
      sourceNodeId: "parallel_enrich",
    };

    const suggestions = getSuggestedKinds(context);
    const kinds = suggestions.map((s) => s.kind);
    expect(kinds).toContain("agent_call");
    expect(kinds).toContain("http_call");
  });

  it("returns branch-specific suggestions for add-catch-handler", () => {
    const context: InsertionContext = {
      mode: "add-catch-handler",
      sourceNodeId: "try_catch_1",
    };

    const suggestions = getSuggestedKinds(context);
    const kinds = suggestions.map((s) => s.kind);
    expect(kinds).toContain("notification");
    expect(kinds).toContain("raise_error");
  });

  it("returns default suggestions when source kind is unknown", () => {
    const context: InsertionContext = {
      mode: "edge-splice",
      sourceKind: "unknown_task_type",
      sourceNodeId: "unknown_1",
    };

    const suggestions = getSuggestedKinds(context);
    const kinds = suggestions.map((s) => s.kind);
    expect(kinds).toContain("agent_call");
    expect(kinds).toContain("llm_call");
  });

  it("returns default suggestions for add-at-position mode", () => {
    const context: InsertionContext = {
      mode: "add-at-position",
    };

    const suggestions = getSuggestedKinds(context);
    expect(suggestions.length).toBeGreaterThan(0);
    const kinds = suggestions.map((s) => s.kind);
    expect(kinds).toContain("agent_call");
  });

  it("respects maxResults parameter", () => {
    const context: InsertionContext = {
      mode: "append-after",
      sourceKind: "agent_call",
      sourceNodeId: "agent_call_1",
    };

    const suggestions = getSuggestedKinds(context, 2);
    expect(suggestions.length).toBeLessThanOrEqual(2);
  });

  it("every suggestion has a non-empty reason", () => {
    const context: InsertionContext = {
      mode: "append-after",
      sourceKind: "http_call",
      sourceNodeId: "http_call_1",
    };

    const suggestions = getSuggestedKinds(context);
    for (const s of suggestions) {
      expect(s.reason).toBeTruthy();
      expect(s.reason.length).toBeGreaterThan(0);
    }
  });

  it("suggestions for agent_call include switch_case and human_input", () => {
    const context: InsertionContext = {
      mode: "append-after",
      sourceKind: "agent_call",
      sourceNodeId: "agent_1",
    };

    const suggestions = getSuggestedKinds(context);
    const kinds = suggestions.map((s) => s.kind);
    expect(kinds).toContain("switch_case");
    expect(kinds).toContain("human_input");
  });
});
