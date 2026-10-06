// Pins the words every surface uses for a hook set: the CLI's one-line
// summary, the format names, and the plain words beside each event Stigmer
// runs. The CLI and the console both print these, so a change here is a
// user-visible change on both.
import { describe, expect, it } from "vitest";
import {
  HookFormat,
  hookEventLabel,
  hookFormatName,
  hookMatcherLabel,
  hooksSummary,
} from "../hook-words";

describe("hooksSummary", () => {
  it("counts handlers per event in first-seen order, in either format", () => {
    expect(
      hooksSummary("claude-code", [
        { event: "PreToolUse", handlers: [1, 2] },
        { event: "PostToolUse", handlers: [1] },
        { event: "PreToolUse", handlers: [1] },
      ]),
    ).toBe("Claude Code format: PreToolUse 3, PostToolUse 1");
    expect(hooksSummary("cursor", [{ event: "preToolUse", handlers: [1] }])).toBe(
      "Cursor format: preToolUse 1",
    );
  });
});

describe("hookFormatName", () => {
  it("names each wire format, an unset one as Claude Code's", () => {
    expect(hookFormatName(HookFormat.CLAUDE_CODE)).toBe("claude-code");
    expect(hookFormatName(HookFormat.CURSOR)).toBe("cursor");
    expect(hookFormatName(HookFormat.UNSPECIFIED)).toBe("claude-code");
  });
});

describe("hookEventLabel", () => {
  // The plugin reader's run events (RUN_EVENTS in @stigmer/plugin-package),
  // both formats. A new run event needs words before it can be shown.
  const RUN_EVENTS = [
    "PreToolUse",
    "PostToolUse",
    "preToolUse",
    "beforeShellExecution",
    "beforeMCPExecution",
    "postToolUse",
    "afterMCPExecution",
  ];

  it("gives every event Stigmer runs plain words", () => {
    for (const event of RUN_EVENTS) {
      expect(hookEventLabel(event), event).toMatch(/^(Before|After) /);
    }
    expect(hookEventLabel("PreToolUse")).toBe("Before a tool call");
    expect(hookEventLabel("beforeShellExecution")).toBe("Before a shell command");
    expect(hookEventLabel("afterMCPExecution")).toBe("After an MCP tool call");
  });

  it("gives no words to an event Stigmer does not run", () => {
    expect(hookEventLabel("Stop")).toBeNull();
    expect(hookEventLabel("constructor")).toBeNull();
  });
});

describe("hookMatcherLabel", () => {
  it("reads an empty matcher and * as every tool, and leaves others verbatim", () => {
    expect(hookMatcherLabel("")).toBe("every tool");
    expect(hookMatcherLabel("*")).toBe("every tool");
    expect(hookMatcherLabel("Bash")).toBeNull();
  });
});
