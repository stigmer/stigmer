import { describe, it, expect } from "vitest";
import {
  AGENT_EXECUTION_DOCUMENT_ENTRY_ID,
  agentExecutionTabPath,
  parseAgentExecutionTabPath,
} from "../agent-execution-document";
import { ARTIFACT_DOCUMENT_ENTRY_ID } from "../artifact-document";
import { FILE_CHANGE_DOCUMENT_ENTRY_ID } from "../file-change-document";

describe("agent-execution-document identity", () => {
  it("has a distinct family id from the other virtual-document families", () => {
    expect(AGENT_EXECUTION_DOCUMENT_ENTRY_ID).not.toBe(ARTIFACT_DOCUMENT_ENTRY_ID);
    expect(AGENT_EXECUTION_DOCUMENT_ENTRY_ID).not.toBe(FILE_CHANGE_DOCUMENT_ENTRY_ID);
    // NUL-namespaced so it can never alias a real workspace entry id.
    expect(AGENT_EXECUTION_DOCUMENT_ENTRY_ID.startsWith("\u0000")).toBe(true);
  });

  it("labels the tab with the task name (path basename)", () => {
    const path = agentExecutionTabPath("aex_abc123", "summarize-report");
    expect(path).toBe("aex_abc123/summarize-report");
    expect(path.split("/").pop()).toBe("summarize-report");
  });

  it("round-trips the child execution id", () => {
    const path = agentExecutionTabPath("aex_abc123", "summarize-report");
    expect(parseAgentExecutionTabPath(path)).toBe("aex_abc123");
  });

  it("round-trips the id when the task name itself contains a separator", () => {
    const path = agentExecutionTabPath("aex_abc123", "stage/publish");
    expect(parseAgentExecutionTabPath(path)).toBe("aex_abc123");
  });

  it("keeps two calls to the same agent distinct (per-child identity)", () => {
    const first = agentExecutionTabPath("aex_1", "call-agent");
    const second = agentExecutionTabPath("aex_2", "call-agent");
    expect(first).not.toBe(second);
    expect(parseAgentExecutionTabPath(first)).toBe("aex_1");
    expect(parseAgentExecutionTabPath(second)).toBe("aex_2");
  });

  it("degrades to the whole path when no separator is present", () => {
    expect(parseAgentExecutionTabPath("aex_bare")).toBe("aex_bare");
  });
});
