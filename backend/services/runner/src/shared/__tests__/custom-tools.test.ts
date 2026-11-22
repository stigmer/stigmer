/**
 * Pins which of a session's custom tools a turn offers and the names they
 * reach the Claude engine's model under (`custom-tools.ts`): every declared
 * tool, as plain JSON, on a turn someone can answer; none on an unattended
 * turn; none, with a log line, when the declaration fails the control
 * plane's own check; and a fitted name that leads back to its tool.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApprovalMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";

import { CUSTOM_TOOL_SERVER, customToolEngineName, customToolOfEngineName, declaredCustomTools, offeredCustomTools } from "../custom-tools.js";
import { ENGINE_TOOL_NAME_MAX } from "../mcp-tool-names.js";

const FORM = { name: "show_form", description: "Open the form.", inputSchema: { type: "object", properties: { service: { type: "string" } } } };

function sources(tools: { name: string; description: string; inputSchema: Record<string, unknown> }[], mode = ApprovalMode.INTERACTIVE) {
  return {
    session: create(SessionSchema, { spec: { customTools: tools.map((tool) => ({ ...tool, inputSchema: tool.inputSchema as never })) } }),
    execution: create(RunSchema, { status: { approvalMode: mode } }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("offeredCustomTools", () => {
  it("offers every declared tool, its schema as plain JSON, on a turn someone can answer", () => {
    expect(offeredCustomTools(sources([FORM]))).toEqual([FORM]);
    expect(offeredCustomTools(sources([FORM], ApprovalMode.UNSPECIFIED))).toEqual([FORM]);
    expect(offeredCustomTools(sources([]))).toEqual([]);
    expect(declaredCustomTools(create(SessionSchema, {}))).toEqual([]);
  });

  it("offers none on an unattended turn", () => {
    expect(offeredCustomTools(sources([FORM], ApprovalMode.UNATTENDED))).toEqual([]);
  });

  it("offers none, and says why in the log, when the declaration fails the shared check", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(offeredCustomTools(sources([{ ...FORM, name: "Bash" }]))).toEqual([]);
    expect(warn).toHaveBeenCalledWith("[custom-tools] the session's custom tools are not offered: The name of custom tool 'Bash' is a built-in tool's; choose another.");
  });
});

describe("the Claude engine's names", () => {
  it("serves them under the platform's reserved server, as Claude Code names them, never fitted, and reads a name back to its tool", () => {
    expect(customToolEngineName("show_form")).toBe(`mcp__${CUSTOM_TOOL_SERVER}__show_form`);
    // The longest name a session may declare keeps its whole name, as Claude Code itself names it.
    const long = { ...FORM, name: "t".repeat(64) };
    expect(customToolEngineName(long.name)).toBe(`mcp__${CUSTOM_TOOL_SERVER}__${"t".repeat(64)}`);
    expect(customToolEngineName(long.name).length).toBeGreaterThan(ENGINE_TOOL_NAME_MAX);
    expect(customToolOfEngineName([FORM, long], customToolEngineName(long.name))).toBe(long);
    expect(customToolOfEngineName([FORM], "mcp__other__show_form")).toBeUndefined();
  });
});
