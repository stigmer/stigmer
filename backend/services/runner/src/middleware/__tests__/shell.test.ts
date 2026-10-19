/**
 * The shell middleware's edges (`../shell.ts`), beside the real-graph facts
 * in `execute-deep-agent/__tests__/shell-binding.test.ts`: a model call with
 * no tools, a tool that is not `execute`, and an `execute` whose schema it
 * cannot read or extend all pass through unchanged (a lost `timeout` is
 * better than a broken shell); the declaration it presents is made once per
 * bound tool; and only an `execute` call is handed the runner's tool.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createShellMiddleware } from "../shell.js";
import type { ModelCallRequest, ToolCallRequest } from "../types.js";

const RUNNER_TOOL = { name: "execute", marker: "runner" };

function modelRequest(tools: unknown[] | undefined): ModelCallRequest {
  return { model: {}, messages: [], tools, state: {}, runtime: {} };
}

function toolRequest(name: string): ToolCallRequest {
  return { toolCall: { id: "c1", name, args: {} }, tool: { name }, state: {}, runtime: {} };
}

async function toolsSeen(tools: unknown[] | undefined): Promise<unknown[] | undefined> {
  const shell = createShellMiddleware({ tool: RUNNER_TOOL });
  let seen: unknown[] | undefined;
  await shell.wrapModelCall!(modelRequest(tools), (request) => {
    seen = request.tools;
    return {} as never;
  });
  return seen;
}

describe("the shell middleware", () => {
  it("passes a model call with no tools through untouched", async () => {
    expect(await toolsSeen(undefined)).toBeUndefined();
    expect(await toolsSeen([])).toEqual([]);
  });

  it("leaves every tool but execute, and anything that is not a tool, as it is", async () => {
    const read = { name: "read_file", description: "Read.", schema: z.object({ path: z.string() }) };
    const tools = [read, "not-a-tool", null];
    const seen = await toolsSeen(tools);
    expect(seen).toBe(tools);
  });

  it("keeps deepagents' execute when its schema cannot be read or is not an object", async () => {
    // A schema no reader can open: every property read throws.
    const unreadable = { name: "execute", description: "Run.", schema: new Proxy({}, { get: () => { throw new Error("no schema"); } }) };
    const notAnObject = { name: "execute", description: "Run.", schema: { type: "string" } };
    expect((await toolsSeen([unreadable]))![0]).toBe(unreadable);
    expect((await toolsSeen([notAnObject]))![0]).toBe(notAnObject);
  });

  it("presents one declaration per bound tool, with the timeout beside the command", async () => {
    const shell = createShellMiddleware({ tool: RUNNER_TOOL });
    const execute = { name: "execute", description: "Run.", schema: z.object({ command: z.string() }) };
    const seen: unknown[] = [];
    const handler = (request: ModelCallRequest) => {
      seen.push(request.tools![0]);
      return {} as never;
    };
    await shell.wrapModelCall!(modelRequest([execute]), handler);
    await shell.wrapModelCall!(modelRequest([execute]), handler);
    expect(seen[0]).toBe(seen[1]);
    expect(Object.keys((seen[0] as { schema: { properties: object } }).schema.properties)).toEqual(["command", "timeout"]);
  });

  it("hands only an execute call the runner's tool", async () => {
    const shell = createShellMiddleware({ tool: RUNNER_TOOL });
    const handler = vi.fn((request: ToolCallRequest) => request.tool as never);
    expect(await shell.wrapToolCall!(toolRequest("execute"), handler)).toBe(RUNNER_TOOL);
    expect(await shell.wrapToolCall!(toolRequest("read_file"), handler)).toEqual({ name: "read_file" });
  });
});
