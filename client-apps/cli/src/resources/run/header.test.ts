import { create } from "@bufbuild/protobuf";
import {
  WorkspaceEntrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { describe, expect, it } from "vitest";
import { renderSessionHeader, workspaceNames } from "./header.js";

function capture(): { out: { write(c: string): void; isTTY: boolean }; text: () => string } {
  let buf = "";
  return {
    out: { write: (c: string) => void (buf += c), isTTY: false },
    text: () => buf,
  };
}

describe("renderSessionHeader", () => {
  it("omits empty fields and aligns labels", () => {
    const { out, text } = capture();
    renderSessionHeader(out, { agentName: "Reviewer", sessionId: "ses_abc", model: "", mode: "", workspaces: [] });
    expect(text()).toBe("Agent:      Reviewer\nSession:    ses_abc\n\n");
  });

  it("surfaces plan mode but not agent/default", () => {
    const plan = capture();
    renderSessionHeader(plan.out, { agentName: "", sessionId: "", model: "", mode: "plan", workspaces: [] });
    expect(plan.text()).toContain("Mode:");
    expect(plan.text()).toContain("Plan (read-only)");

    const agent = capture();
    renderSessionHeader(agent.out, { agentName: "", sessionId: "s", model: "", mode: "agent", workspaces: [] });
    expect(agent.text()).not.toContain("Mode:");
  });

  it("indents extra workspaces under the first", () => {
    const { out, text } = capture();
    renderSessionHeader(out, {
      agentName: "",
      sessionId: "",
      model: "",
      mode: "",
      workspaces: ["app", "infra"],
    });
    expect(text()).toBe("Workspaces: app\n            infra\n\n");
  });

  it("prints nothing when every field is empty", () => {
    const { out, text } = capture();
    renderSessionHeader(out, { agentName: "", sessionId: "", model: "", mode: "", workspaces: [] });
    expect(text()).toBe("");
  });
});

describe("workspaceNames", () => {
  it("extracts the derived name from each entry", () => {
    const entries = [
      create(WorkspaceEntrySchema, { name: "app" }),
      create(WorkspaceEntrySchema, { name: "infra" }),
    ];
    expect(workspaceNames(entries)).toEqual(["app", "infra"]);
  });
});
