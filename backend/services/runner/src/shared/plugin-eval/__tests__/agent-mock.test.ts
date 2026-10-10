/**
 * Pins the agent mock's request and reading (`agent-mock.ts`): the
 * instructions as the system prompt, the server's earlier calls as the
 * conversation and this call last; an `ABORT:` first line ends the run only
 * when the mock may abort.
 */

import { describe, expect, it } from "vitest";
import { agentMockMessages, readAnswer } from "../agent-mock.js";

describe("agentMockMessages", () => {
  it("frames the instructions, replays the server's history, and asks this call last", () => {
    const messages = agentMockMessages({
      server: "tracker",
      tool: "get_issue",
      instructions: "You are an issue tracker.",
      abortWhen: "the issue id is negative",
      input: { id: 12 },
      history: [{ tool: "create_issue", input: { title: "Crash" }, answer: "Created #12" }],
    });
    expect(messages.map((m) => [m.getType(), m.content])).toEqual([
      [
        "system",
        [
          "You are standing in for the MCP server 'tracker' while a plugin is tested.",
          "Answer each tool call exactly as that server would, following these instructions, and reply with the tool's result only.",
          "",
          "You are an issue tracker.",
          "",
          "You may end the test only when one of these conditions holds: the issue id is negative",
          "To end it, reply with a single first line `ABORT: <the reason>` and nothing else.",
        ].join("\n"),
      ],
      ["human", 'Tool: create_issue\nInput: {"title":"Crash"}'],
      ["ai", "Created #12"],
      ["human", 'Tool: get_issue\nInput: {"id":12}'],
    ]);
  });

  it("says nothing of ending the test when the mock may not", () => {
    const [system] = agentMockMessages({ server: "s", tool: "t", instructions: "Answer.", abortWhen: "", input: undefined, history: [] });
    expect(String(system?.content)).not.toContain("ABORT");
  });
});

describe("readAnswer", () => {
  it("reads an ABORT first line as the end of the run, only when the mock may abort", () => {
    expect(readAnswer("ABORT: the issue id is negative", true, 0.1)).toEqual({ kind: "abort", reason: "the issue id is negative", costUsd: 0.1 });
    expect(readAnswer("ABORT:", true, 0)).toEqual({ kind: "abort", reason: "the mock ended the run", costUsd: 0 });
    expect(readAnswer("ABORT: no", false, 0)).toEqual({ kind: "answer", text: "ABORT: no", costUsd: 0 });
    expect(readAnswer("Issue #12\nABORT: later line", true, 0)).toEqual({ kind: "answer", text: "Issue #12\nABORT: later line", costUsd: 0 });
  });
});
