import { describe, it, expect } from "vitest";
import { buildInsertionHeader } from "../insertion-context";
import type { InsertionContext } from "../insertion-context";

describe("buildInsertionHeader", () => {
  it("builds header for edge-splice with display names", () => {
    const context: InsertionContext = {
      mode: "edge-splice",
      sourceNodeId: "classify_ticket",
      sourceDisplayName: "classify_ticket",
      targetNodeId: "route_by_severity",
      targetDisplayName: "route_by_severity",
    };

    expect(buildInsertionHeader(context)).toBe(
      "Insert between classify_ticket and route_by_severity",
    );
  });

  it("builds header for edge-splice with fallback to node IDs", () => {
    const context: InsertionContext = {
      mode: "edge-splice",
      sourceNodeId: "node_a",
      targetNodeId: "node_b",
    };

    expect(buildInsertionHeader(context)).toBe(
      "Insert between node_a and node_b",
    );
  });

  it("builds header for append-after mode", () => {
    const context: InsertionContext = {
      mode: "append-after",
      sourceNodeId: "run_analyst",
      sourceDisplayName: "run_analyst",
    };

    expect(buildInsertionHeader(context)).toBe("Add after run_analyst");
  });

  it("builds header for add-at-position mode", () => {
    const context: InsertionContext = {
      mode: "add-at-position",
    };

    expect(buildInsertionHeader(context)).toBe("Add task");
  });

  it("builds header for add-switch-case mode", () => {
    const context: InsertionContext = {
      mode: "add-switch-case",
      sourceNodeId: "classify_user",
      sourceDisplayName: "classify_user",
    };

    expect(buildInsertionHeader(context)).toBe("Add case to classify_user");
  });

  it("builds header for add-fork-branch mode", () => {
    const context: InsertionContext = {
      mode: "add-fork-branch",
      sourceNodeId: "parallel_enrich",
      sourceDisplayName: "parallel_enrich",
    };

    expect(buildInsertionHeader(context)).toBe("Add branch to parallel_enrich");
  });

  it("builds header for add-catch-handler mode", () => {
    const context: InsertionContext = {
      mode: "add-catch-handler",
      sourceNodeId: "risky_operation",
      sourceDisplayName: "risky_operation",
    };

    expect(buildInsertionHeader(context)).toBe("Add catch handler to risky_operation");
  });

  it("uses ellipsis when node IDs are missing", () => {
    const context: InsertionContext = {
      mode: "edge-splice",
    };

    expect(buildInsertionHeader(context)).toBe("Insert between … and …");
  });
});
