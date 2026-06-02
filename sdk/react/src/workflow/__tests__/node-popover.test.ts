import { describe, test, expect } from "vitest";
import type { CanvasTaskNodeData } from "../workflow-graph-conversions";

// ---------------------------------------------------------------------------
// WorkflowNodePopover — config summary extraction logic
//
// Tests the pure function that extracts a one-line config summary
// for different task kinds. Mirrors the switch statement in
// WorkflowNodePopover.tsx:extractConfigSummary.
// ---------------------------------------------------------------------------

function extractConfigSummary(data: Partial<CanvasTaskNodeData>): string | null {
  const config = data.config as Record<string, unknown> | undefined;
  if (!config) return null;

  switch (data.kindString) {
    case "agent_call": {
      const agent = config.agent as string | undefined;
      return agent ? `Agent: ${agent}` : null;
    }
    case "call_http":
    case "http_call": {
      const method = (config.method as string) ?? "GET";
      const url = config.url as string | undefined;
      return url ? `${method.toUpperCase()} ${url}` : null;
    }
    case "call_llm":
    case "llm_call": {
      const model = config.model as string | undefined;
      return model ? `Model: ${model}` : null;
    }
    case "switch_case": {
      const cases = config.cases as unknown[];
      return cases ? `${cases.length} case${cases.length === 1 ? "" : "s"}` : null;
    }
    case "fork": {
      const branches = config.branches as unknown[];
      return branches ? `${branches.length} branch${branches.length === 1 ? "" : "es"}` : null;
    }
    case "wait": {
      const dur = config.duration as Record<string, unknown> | undefined;
      const secs = dur?.seconds as number | undefined;
      return secs ? `Wait ${secs}s` : null;
    }
    case "run_workflow": {
      const wfRef = config.workflow_ref as string | undefined;
      return wfRef ? `Workflow: ${wfRef}` : null;
    }
    default:
      return null;
  }
}

describe("extractConfigSummary", () => {
  test("agent_call returns agent name", () => {
    expect(extractConfigSummary({
      kindString: "agent_call",
      config: { agent: "support-bot" },
    })).toBe("Agent: support-bot");
  });

  test("agent_call returns null when no agent", () => {
    expect(extractConfigSummary({
      kindString: "agent_call",
      config: {},
    })).toBeNull();
  });

  test("http_call returns method + URL", () => {
    expect(extractConfigSummary({
      kindString: "http_call",
      config: { method: "POST", url: "https://api.example.com/hook" },
    })).toBe("POST https://api.example.com/hook");
  });

  test("http_call defaults method to GET", () => {
    expect(extractConfigSummary({
      kindString: "call_http",
      config: { url: "https://api.example.com/data" },
    })).toBe("GET https://api.example.com/data");
  });

  test("llm_call returns model name", () => {
    expect(extractConfigSummary({
      kindString: "call_llm",
      config: { model: "claude-sonnet-4" },
    })).toBe("Model: claude-sonnet-4");
  });

  test("switch_case returns case count (singular)", () => {
    expect(extractConfigSummary({
      kindString: "switch_case",
      config: { cases: [{ name: "happy" }] },
    })).toBe("1 case");
  });

  test("switch_case returns case count (plural)", () => {
    expect(extractConfigSummary({
      kindString: "switch_case",
      config: { cases: [{ name: "a" }, { name: "b" }, { name: "c" }] },
    })).toBe("3 cases");
  });

  test("fork returns branch count", () => {
    expect(extractConfigSummary({
      kindString: "fork",
      config: { branches: [{ name: "left" }, { name: "right" }] },
    })).toBe("2 branches");
  });

  test("fork returns singular branch", () => {
    expect(extractConfigSummary({
      kindString: "fork",
      config: { branches: [{ name: "only" }] },
    })).toBe("1 branch");
  });

  test("wait returns duration", () => {
    expect(extractConfigSummary({
      kindString: "wait",
      config: { duration: { seconds: 30 } },
    })).toBe("Wait 30s");
  });

  test("run_workflow returns workflow ref", () => {
    expect(extractConfigSummary({
      kindString: "run_workflow",
      config: { workflow_ref: "acme/data-pipeline" },
    })).toBe("Workflow: acme/data-pipeline");
  });

  test("unknown kind returns null", () => {
    expect(extractConfigSummary({
      kindString: "set_variables",
      config: { variables: {} },
    })).toBeNull();
  });

  test("null config returns null", () => {
    expect(extractConfigSummary({
      kindString: "agent_call",
      config: undefined,
    })).toBeNull();
  });
});
