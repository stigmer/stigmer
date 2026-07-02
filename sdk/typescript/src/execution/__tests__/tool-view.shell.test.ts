// Covers shell normalization's `command` capture and result-shape handling: a
// terminal view models the whole session (prompt + output), so the command is
// echoed from args onto the view across every result shape — un-enveloped Cursor
// JSON, the Cursor {status,value} envelope, the exit-marker form, and plain
// text. The cross-language fixture (result-views.json) asserts the happy path;
// these cover the branch matrix, the envelope unwrap (the reported bug), and the
// missing-command edge.

import { describe, it, expect } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ToolCallStatus,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { normalizeToolResult } from "../tool-view";

function shellCall(args: Record<string, unknown>, result: string) {
  return create(ToolCallSchema, {
    id: "tc-shell",
    name: "shell",
    toolKind: ToolKind.SHELL,
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    args: args as JsonObject,
    result,
  });
}

describe("normalizeToolResult — shell command capture", () => {
  it("captures the command on the plain (no-marker) branch", () => {
    const view = normalizeToolResult(shellCall({ command: "echo hi" }, "hi\n"));
    expect(view.type).toBe("terminal");
    if (view.type !== "terminal") return;
    expect(view.command).toBe("echo hi");
    expect(view.stdout).toBe("hi\n");
  });

  it("captures the command on the exit-marker branch (success and failure)", () => {
    const ok = normalizeToolResult(
      shellCall({ command: "ls -la" }, "total 8\n[Command succeeded]"),
    );
    expect(ok.type).toBe("terminal");
    if (ok.type !== "terminal") return;
    expect(ok.command).toBe("ls -la");
    expect(ok.exitCode).toBe(0);

    const bad = normalizeToolResult(
      shellCall({ command: "false" }, "boom\n[Command failed with exit code 2]"),
    );
    expect(bad.type).toBe("terminal");
    if (bad.type !== "terminal") return;
    expect(bad.command).toBe("false");
    expect(bad.exitCode).toBe(2);
  });

  it("captures the command on the structured Cursor JSON branch", () => {
    const view = normalizeToolResult(
      shellCall(
        { command: "npm test" },
        JSON.stringify({ stdout: "ok", stderr: "", exitCode: 0 }),
      ),
    );
    expect(view.type).toBe("terminal");
    if (view.type !== "terminal") return;
    expect(view.command).toBe("npm test");
    expect(view.stdout).toBe("ok");
  });

  it("unwraps the Cursor {status,value} envelope on success (the reported bug)", () => {
    const view = normalizeToolResult(
      shellCall(
        { command: "ls -la" },
        JSON.stringify({
          status: "success",
          value: {
            exitCode: 0,
            signal: "",
            stdout: "total 8\ndrwxr-xr-x  2 user user 4096 .\n",
            stderr: "",
            executionTime: 1176,
          },
        }),
      ),
    );
    expect(view.type).toBe("terminal");
    if (view.type !== "terminal") return;
    expect(view.command).toBe("ls -la");
    // The real stdout surfaces — NOT the raw envelope JSON.
    expect(view.stdout).toBe("total 8\ndrwxr-xr-x  2 user user 4096 .\n");
    expect(view.exitCode).toBe(0);
    // Regression guard: the envelope keys must never leak into the rendered output.
    expect(view.stdout).not.toContain("status");
    expect(view.stdout).not.toContain("value");
    expect(view.stdout).not.toContain("executionTime");
  });

  it("unwraps the Cursor envelope on failure (surfaces stderr and exit code)", () => {
    const view = normalizeToolResult(
      shellCall(
        { command: "ls /nope" },
        JSON.stringify({
          status: "success",
          value: {
            exitCode: 2,
            signal: "",
            stdout: "",
            stderr: "ls: /nope: No such file or directory\n",
            executionTime: 5,
          },
        }),
      ),
    );
    expect(view.type).toBe("terminal");
    if (view.type !== "terminal") return;
    expect(view.command).toBe("ls /nope");
    expect(view.stderr).toBe("ls: /nope: No such file or directory\n");
    expect(view.exitCode).toBe(2);
  });

  it("leaves command undefined when args carry no command", () => {
    const view = normalizeToolResult(shellCall({}, "orphan output\n"));
    expect(view.type).toBe("terminal");
    if (view.type !== "terminal") return;
    expect(view.command).toBeUndefined();
    expect(view.stdout).toBe("orphan output\n");
  });
});
