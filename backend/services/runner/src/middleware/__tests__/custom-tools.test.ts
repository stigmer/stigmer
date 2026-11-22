/**
 * Pins the Stigmer harness's custom-tool middleware (`custom-tools.ts`) and
 * the tools it guards (`execute-deep-agent/custom-tools.ts`) on their own:
 * a call of another tool passes through untouched; a mismatched input is
 * refused with the shared sentence and its refusal written to the stream;
 * a matching one pauses with the host's mark before its handler runs; and
 * a tool hands the model the host's answer, an error as an error message,
 * and says so when it was reached with no answer.
 */

import { describe, expect, it, vi } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import { customToolInputProblem } from "@stigmer/tool-vocabulary";

vi.mock("@langchain/langgraph", async (original) => ({
  ...(await original<typeof import("@langchain/langgraph")>()),
  interrupt: vi.fn((payload: unknown) => {
    throw Object.assign(new Error("paused"), { payload });
  }),
}));

import { createCustomToolGateMiddleware } from "../custom-tools.js";
import { createCustomTools, NO_HOST_ANSWER_MESSAGE } from "../../activities/execute-deep-agent/custom-tools.js";
import { CUSTOM_TOOL_WAITING_MESSAGE } from "../../shared/custom-tools.js";
import type { ToolCallRequest } from "../types.js";

const FORM = { name: "show_form", description: "Open the form.", inputSchema: { type: "object", properties: { service: { type: "string" } }, required: ["service"] } };

function request(name: string, args: Record<string, unknown>, writer = vi.fn()): ToolCallRequest {
  return { toolCall: { id: "call_1", name, args }, runtime: { writer } } as unknown as ToolCallRequest;
}

describe("the custom-tool middleware", () => {
  const middleware = createCustomToolGateMiddleware({ tools: [FORM] });
  const wrap = middleware.wrapToolCall!;

  it("passes any other tool's call to its handler untouched", async () => {
    const handler = vi.fn(async () => new ToolMessage({ content: "ran", tool_call_id: "call_1" }));
    const call = request("read_file", { file_path: "/a" });
    expect(await wrap(call, handler)).toMatchObject({ content: "ran" });
    expect(handler).toHaveBeenCalledWith(call);
  });

  it("refuses a mismatched input with the shared sentence, written to the stream, and never pauses", async () => {
    const writer = vi.fn();
    const handler = vi.fn();
    const answer = (await wrap(request(FORM.name, { repo: "x" }, writer), handler)) as ToolMessage;
    const problem = customToolInputProblem(FORM, { repo: "x" });
    expect([answer.content, answer.status]).toEqual([problem, "error"]);
    expect(writer).toHaveBeenCalledWith(expect.objectContaining({ name: "stigmer.tool_refused", tool_call_id: "call_1", message: problem }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("pauses a matching call with the host's mark before its handler runs", async () => {
    const handler = vi.fn();
    await expect(wrap(request(FORM.name, { service: "payments" }), handler)).rejects.toMatchObject({
      payload: { tool_call_id: "call_1", tool_name: FORM.name, mcp_server_slug: "", message: CUSTOM_TOOL_WAITING_MESSAGE, custom_tool: true },
    });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("the custom tools", () => {
  const answers = new Map([
    ["call_ok", { text: "registered", isError: false }],
    ["call_err", { text: "closed the form", isError: true }],
  ]);
  const [tool] = createCustomTools([FORM], answers);
  const call = (id: string) => tool!.invoke({ id, name: FORM.name, args: { service: "x" }, type: "tool_call" });

  it("hands the model the host's answer, an error as an error message", async () => {
    expect(await call("call_ok")).toMatchObject({ content: "registered" });
    expect(await call("call_err")).toMatchObject({ content: "closed the form", status: "error" });
  });

  it("says so when reached with no answer", async () => {
    expect(await call("call_none")).toMatchObject({ content: NO_HOST_ANSWER_MESSAGE, status: "error" });
  });
});
