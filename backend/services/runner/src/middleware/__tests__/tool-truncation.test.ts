/**
 * What the model sees of a long tool result, and where the whole of it is
 * kept (`../tool-truncation.ts`): the start and the end within the bound with
 * the gap line between; the whole text written through a real routed backend
 * to the session's offload directory and read back byte for byte; the tools
 * that page themselves cut with no file; a kept tool's bound clamped at
 * deepagents' threshold; every shape a tool returns (a `Command`, an array of
 * blocks) and every field of the message kept; nothing kept, and nothing
 * written, without a routed backend.
 */

import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import { Command, isCommand } from "@langchain/langgraph";
import { FilesystemBackend, type AnyBackendProtocol } from "deepagents";

import {
  createToolTruncationMiddleware,
  cutToBound,
  DEEPAGENTS_OFFLOAD_THRESHOLD_CHARS,
  GAP_LINE,
  keptResultPath,
  NARROW_A_CALL,
} from "../tool-truncation.js";
import type { ToolCallRequest } from "../types.js";
import { mountPlatformRoute } from "../../activities/execute-deep-agent/platform-route.js";
import { offloadDirBeside } from "../../shared/workspace/platform-dir.js";

function makeRequest(name = "execute", id = "tc_1"): ToolCallRequest {
  return {
    toolCall: { id, name, args: {} },
    tool: undefined,
    state: { messages: [] },
    runtime: {},
  };
}

function makeToolMessage(content: string, id = "tc_1", name = "execute"): ToolMessage {
  return new ToolMessage({ content, tool_call_id: id, name });
}

/** `count` numbered lines of 10 characters each: "line 0001\n" … */
function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${String(i + 1).padStart(4, "0")}\n`).join("");
}

async function run(
  mw: ReturnType<typeof createToolTruncationMiddleware>,
  result: ToolMessage | Command,
  request = makeRequest(),
): Promise<ToolMessage | Command> {
  return mw.wrapToolCall!(request, vi.fn().mockResolvedValue(result));
}

function contentOf(result: ToolMessage | Command): string {
  expect(ToolMessage.isInstance(result)).toBe(true);
  return (result as ToolMessage).content as string;
}

let root: string;
let workspaceDir: string;
let offloadDir: string;
let routed: AnyBackendProtocol;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tool-truncation-"));
  workspaceDir = join(root, "workspace");
  const platformDir = join(root, "session", "platform");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(platformDir, { recursive: true });
  offloadDir = offloadDirBeside(platformDir);
  routed = await mountPlatformRoute(new FilesystemBackend({ rootDir: workspaceDir, virtualMode: true }), {
    workspaceDir,
    platformDir,
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("cutToBound", () => {
  const gap = (o: Parameters<typeof GAP_LINE.notKept>[0]) => GAP_LINE.notKept(o);

  it("leaves a text within the bound as it is", () => {
    expect(cutToBound("short", 5, gap)).toEqual({ text: "short", omitted: 0 });
  });

  it("keeps the start and the end at line ends, the gap line naming what was left out", () => {
    const text = numberedLines(1000);
    const { text: cut, omitted } = cutToBound(text, 1000, gap);
    expect(cut.length).toBeLessThanOrEqual(1000);
    const lines = cut.split("\n");
    expect(lines[0]).toBe("line 0001");
    const gapAt = lines.findIndex((line) => line.startsWith("[…"));
    const lastHead = Number(lines[gapAt - 1]!.slice(5));
    const firstTail = Number(lines[gapAt + 1]!.slice(5));
    expect(lines[gapAt]).toBe(GAP_LINE.notKept({
      chars: (firstTail - lastHead - 1) * 10,
      firstLine: lastHead + 1,
      lastLine: firstTail - 1,
      totalLines: 1000,
    }));
    expect(omitted).toBe((firstTail - lastHead - 1) * 10);
    expect(cut.endsWith("line 1000\n")).toBe(true);
  });

  it("cuts a single long line by characters, within the bound", () => {
    const text = "x".repeat(5000);
    const { text: cut, omitted } = cutToBound(text, 500, gap);
    expect(cut.length).toBeLessThanOrEqual(500);
    const [head, line, tail] = cut.split("\n");
    expect(line).toBe(GAP_LINE.notKept({ chars: omitted, firstLine: 1, lastLine: 1, totalLines: 1 }));
    expect(head!.length + tail!.length + omitted).toBe(5000);
  });

  it("leaves the gap line alone when the bound is smaller than it", () => {
    const { text: cut, omitted } = cutToBound("y".repeat(200), 20, gap);
    expect(cut).toBe(GAP_LINE.notKept({ chars: 200, firstLine: 1, lastLine: 1, totalLines: 1 }));
    expect(omitted).toBe(200);
  });

  it("never splits a surrogate pair at either cut", () => {
    for (let bound = 120; bound < 140; bound++) {
      const { text: cut } = cutToBound("😀".repeat(400), bound, gap);
      expect(Buffer.from(cut, "utf8").toString("utf8"), `bound ${bound}: no lone surrogate`).toBe(cut);
      expect(cut.length).toBeLessThanOrEqual(bound);
    }
  });
});

describe("ToolTruncationMiddleware", () => {
  it("passes through results within the bound, the same message", async () => {
    const mw = createToolTruncationMiddleware({ maxChars: 100, backend: routed });
    const message = makeToolMessage("short");
    expect(await run(mw, message)).toBe(message);
    expect(mw.truncationCount).toBe(0);
    expect(await readdir(join(offloadDir, "large_tool_results"))).toEqual([]);
  });

  it("keeps a long result whole through the routed backend and points the model at it", async () => {
    const text = numberedLines(2000);
    const mw = createToolTruncationMiddleware({ maxChars: 2000, backend: routed });
    const content = contentOf(await run(mw, makeToolMessage(text)));

    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content.startsWith("line 0001\n")).toBe(true);
    expect(content.endsWith("line 2000\n")).toBe(true);
    expect(content).toMatch(/^\[… \d+ characters omitted \(lines \d+–\d+ of 2000\)\. The whole result is kept at \/large_tool_results\/tc_1\.txt: read_file it from offset \d+, or grep it\.\]$/m);
    expect(await readFile(join(offloadDir, "large_tool_results", "tc_1.txt"), "utf8")).toBe(text);
    expect(await readdir(workspaceDir)).toEqual([]);

    // The pointer's offset reads the first line left out.
    const offset = Number(/from offset (\d+)/.exec(content)![1]);
    const read = await routed.read("/large_tool_results/tc_1.txt", offset, 1);
    const lastShown = content.split("\n").find((_, i, all) => all[i + 1]?.startsWith("[…"));
    expect(JSON.stringify(read)).toContain(`line ${String(Number(lastShown!.slice(5)) + 1).padStart(4, "0")}`);
  });

  it("keeps a command's verdict: stderr and the exit status at its end", async () => {
    const text = `${numberedLines(5000)}[stderr] FAILED: 3 tests\n\nExit code: 1\n[Command failed with exit code 1]`;
    const mw = createToolTruncationMiddleware({ maxChars: 4000, backend: routed });
    const content = contentOf(await run(mw, makeToolMessage(text)));
    expect(content).toContain("[stderr] FAILED: 3 tests");
    expect(content.endsWith("[Command failed with exit code 1]")).toBe(true);
    expect(content).toContain("The whole result is kept at /large_tool_results/tc_1.txt");
  });

  it("cuts a kept tool at deepagents' threshold, and a tool deepagents never offloads at the run's bound", async () => {
    const mw = createToolTruncationMiddleware({ maxChars: 200_000, backend: routed });
    const text = "z".repeat(100_000);

    expect(contentOf(await run(mw, makeToolMessage(text))).length).toBeLessThanOrEqual(DEEPAGENTS_OFFLOAD_THRESHOLD_CHARS);
    expect(contentOf(await run(mw, makeToolMessage(text, "tc_1", "web_fetch"), makeRequest("web_fetch"))).length)
      .toBeLessThanOrEqual(DEEPAGENTS_OFFLOAD_THRESHOLD_CHARS);
    const read = makeToolMessage(text, "tc_1", "read_file");
    expect(await run(mw, read, makeRequest("read_file"))).toBe(read);
  });

  it.each([...NARROW_A_CALL.keys()])("cuts %s, which pages itself, with no file and a line saying how to narrow", async (tool) => {
    const mw = createToolTruncationMiddleware({ maxChars: 1000, backend: routed });
    const content = contentOf(await run(mw, makeToolMessage(numberedLines(500), "tc_1", tool), makeRequest(tool)));
    expect(content.length).toBeLessThanOrEqual(1000);
    expect(content).toContain(NARROW_A_CALL.get(tool));
    expect(content).not.toContain("/large_tool_results/");
    expect(await readdir(join(offloadDir, "large_tool_results"))).toEqual([]);
  });

  it("cuts a sub-agent's report inside the Command `task` returns, its other updates untouched", async () => {
    const report = new ToolMessage({ content: numberedLines(1000), tool_call_id: "tc_task", name: "task" });
    const command = new Command({ update: { messages: [report], todos: [{ content: "x", status: "done" }] }, goto: "next" });
    const mw = createToolTruncationMiddleware({ maxChars: 2000, backend: routed });

    const result = await run(mw, command, makeRequest("task", "tc_task"));
    expect(isCommand(result)).toBe(true);
    const update = (result as Command).update as { messages: ToolMessage[]; todos: unknown };
    expect(update.todos).toEqual([{ content: "x", status: "done" }]);
    expect((result as Command).goto).toEqual(["next"]);
    expect(update.messages).toHaveLength(1);
    expect((update.messages[0]!.content as string).length).toBeLessThanOrEqual(2000);
    expect(update.messages[0]!.content).toContain("/large_tool_results/tc_task.txt");
    expect(update.messages[0]!.tool_call_id).toBe("tc_task");
    expect(await readFile(join(offloadDir, "large_tool_results", "tc_task.txt"), "utf8")).toBe(numberedLines(1000));
  });

  it("returns a Command with nothing long as it came", async () => {
    const command = new Command({ update: { messages: [makeToolMessage("short", "tc_1", "task")] } });
    const mw = createToolTruncationMiddleware({ maxChars: 100, backend: routed });
    expect(await run(mw, command, makeRequest("task"))).toBe(command);
  });

  it("returns a Command carrying no messages, or no object update, as it came", async () => {
    const mw = createToolTruncationMiddleware({ maxChars: 100, backend: routed });
    for (const command of [new Command({ update: { todos: [] } }), new Command({ resume: "yes" }), new Command({ update: [["messages", []]] })]) {
      expect(await run(mw, command, makeRequest("task"))).toBe(command);
    }
  });

  it("measures an array result by its text blocks and keeps its image block", async () => {
    const image = { type: "image", source_type: "base64", mime_type: "image/png", data: "i".repeat(5000) };
    const message = new ToolMessage({
      content: [{ type: "text", text: numberedLines(200) }, image, { type: "text", text: numberedLines(200) }],
      tool_call_id: "tc_1",
      name: "mcp_tool",
    });
    const mw = createToolTruncationMiddleware({ maxChars: 1000, backend: routed });

    const result = (await run(mw, message, makeRequest("mcp_tool"))) as ToolMessage;
    const blocks = result.content as Array<{ type: string; text?: string }>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.type).toBe("text");
    expect(blocks[0]!.text!.length).toBeLessThanOrEqual(1000);
    expect(blocks[1]).toEqual(image);
    expect(await readFile(join(offloadDir, "large_tool_results", "tc_1.txt"), "utf8"))
      .toBe(`${numberedLines(200)}\n${numberedLines(200)}`);
  });

  it("leaves a long text beside a large image within deepagents' threshold as deepagents counts it, so its kept file stands", async () => {
    // deepagents' stringifyToolContent (1.14): every block joined by a line end, a non-text block as its JSON.
    const deepagentsMeasure = (content: ToolMessage["content"]): number =>
      typeof content === "string"
        ? content.length
        : content.map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : JSON.stringify(b))).join("\n").length;
    const image = { type: "image", source_type: "base64", mime_type: "image/png", data: "i".repeat(60_000) };
    const text = numberedLines(4_000);
    const message = new ToolMessage({ content: [{ type: "text", text }, image], tool_call_id: "tc_1", name: "mcp_tool" });
    const mw = createToolTruncationMiddleware({ maxChars: 30_000, backend: routed });

    const result = (await run(mw, message, makeRequest("mcp_tool"))) as ToolMessage;
    expect(deepagentsMeasure(result.content)).toBeLessThanOrEqual(DEEPAGENTS_OFFLOAD_THRESHOLD_CHARS);
    expect((result.content as Array<{ text?: string }>)[0]!.text).toContain("/large_tool_results/tc_1.txt");
    expect((result.content as unknown[])[1]).toEqual(image);
    expect(await readFile(join(offloadDir, "large_tool_results", "tc_1.txt"), "utf8")).toBe(text);
  });

  it("leaves a result its non-text blocks all but fill to deepagents, whole, and keeps nothing itself", async () => {
    const image = { type: "image", source_type: "base64", mime_type: "image/png", data: "i".repeat(DEEPAGENTS_OFFLOAD_THRESHOLD_CHARS) };
    const message = new ToolMessage({ content: [{ type: "text", text: numberedLines(4_000) }, image], tool_call_id: "tc_1", name: "mcp_tool" });
    const mw = createToolTruncationMiddleware({ maxChars: 30_000, backend: routed });

    expect(await run(mw, message, makeRequest("mcp_tool"))).toBe(message);
    expect(await readdir(join(offloadDir, "large_tool_results"))).toEqual([]);
  });

  it("returns an array result with no text block over the bound as it came", async () => {
    const message = new ToolMessage({
      content: [{ type: "image", source_type: "base64", mime_type: "image/png", data: "i".repeat(5000) }],
      tool_call_id: "tc_1",
      name: "mcp_tool",
    });
    const mw = createToolTruncationMiddleware({ maxChars: 1000, backend: routed });
    expect(await run(mw, message, makeRequest("mcp_tool"))).toBe(message);
  });

  it("keeps every field of the original message", async () => {
    const message = new ToolMessage({
      content: "e".repeat(5000),
      tool_call_id: "tc_7",
      name: "mcp_tool",
      id: "msg_7",
      status: "error",
      artifact: { structured: true },
      metadata: { server: "github" },
      additional_kwargs: { k: 1 },
      response_metadata: { r: 2 },
    });
    const mw = createToolTruncationMiddleware({ maxChars: 1000, backend: routed });

    const result = (await run(mw, message, makeRequest("mcp_tool", "tc_7"))) as ToolMessage;
    expect(result).not.toBe(message);
    expect(result.tool_call_id).toBe("tc_7");
    expect(result.name).toBe("mcp_tool");
    expect(result.id).toBe("msg_7");
    expect(result.status).toBe("error");
    expect(result.artifact).toEqual({ structured: true });
    expect(result.metadata).toEqual({ server: "github" });
    expect(result.additional_kwargs).toEqual({ k: 1 });
    expect(result.response_metadata).toEqual({ r: 2 });
  });

  it("keeps nothing, and says so, without a backend, over a backend that does not route the offload root, or when the write fails", async () => {
    const workspace = new FilesystemBackend({ rootDir: workspaceDir, virtualMode: true });
    const failing = Object.assign(Object.create(Object.getPrototypeOf(routed) as object) as AnyBackendProtocol, routed, {
      write: async () => ({ error: "Error writing file: disk full" }),
    });
    const throwing = Object.assign(Object.create(Object.getPrototypeOf(routed) as object) as AnyBackendProtocol, routed, {
      write: async () => { throw new Error("EIO"); },
    });
    for (const backend of [undefined, workspace, failing, throwing]) {
      const mw = createToolTruncationMiddleware({ maxChars: 1000, ...(backend ? { backend } : {}) });
      const content = contentOf(await run(mw, makeToolMessage(numberedLines(500))));
      expect(content.length).toBeLessThanOrEqual(1000);
      expect(content).toContain("The whole result could not be kept; narrow the call to see this part.");
    }
    expect(await readdir(workspaceDir)).toEqual([]);
    expect(await readdir(join(offloadDir, "large_tool_results"))).toEqual([]);
  });

  it("rewrites its own file when a call is retried", async () => {
    const mw = createToolTruncationMiddleware({ maxChars: 1000, backend: routed });
    await run(mw, makeToolMessage(numberedLines(500)));
    await run(mw, makeToolMessage(numberedLines(400)));
    expect(await readdir(join(offloadDir, "large_tool_results"))).toEqual(["tc_1.txt"]);
    expect(await readFile(join(offloadDir, "large_tool_results", "tc_1.txt"), "utf8")).toBe(numberedLines(400));
  });

  it("names the file after the call, path-safe, and hashes an id too long for a name", () => {
    expect(keptResultPath("toolu_01AbC")).toBe("/large_tool_results/toolu_01AbC.txt");
    expect(keptResultPath("../a/b\\c.d")).toBe("/large_tool_results/___a_b_c_d.txt");
    const long = "x".repeat(200);
    expect(keptResultPath(long)).toMatch(/^\/large_tool_results\/call-[0-9a-f]{32}\.txt$/);
    expect(keptResultPath(long)).toBe(keptResultPath(long));
    expect(keptResultPath("")).toMatch(/^\/large_tool_results\/call-[0-9a-f]{32}\.txt$/);
  });

  it("logs the cut with whether the result was kept, never its path or content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const mw = createToolTruncationMiddleware({ maxChars: 1000, backend: routed });
      await run(mw, makeToolMessage(numberedLines(500)));
      const line = warn.mock.calls.map((call) => String(call[0])).find((text) => text.startsWith("[TRUNCATED]"));
      expect(line).toMatch(/^\[TRUNCATED\] tool=execute original_chars=5000 limit=1000 chars_truncated=\d+ kept=yes$/);
    } finally {
      warn.mockRestore();
    }
  });

  it("counts what it left out and tells onTruncation", async () => {
    const onTruncation = vi.fn();
    const mw = createToolTruncationMiddleware({ maxChars: 1000, onTruncation });
    await run(mw, makeToolMessage("a".repeat(5000)), makeRequest("glob"));
    await run(mw, makeToolMessage("a".repeat(5000)), makeRequest("glob"));

    expect(mw.truncationCount).toBe(2);
    const [[tool, chars]] = onTruncation.mock.calls as [[string, number]];
    expect(tool).toBe("glob");
    expect(mw.totalCharsTruncated).toBe(2 * chars);
    expect(chars).toBeGreaterThan(4000);
  });

  it("resets its counters on beforeAgent", async () => {
    const mw = createToolTruncationMiddleware({ maxChars: 10 });
    await run(mw, makeToolMessage("a".repeat(50)));
    expect(mw.truncationCount).toBe(1);

    mw.beforeAgent!({}, {});
    expect(mw.truncationCount).toBe(0);
    expect(mw.totalCharsTruncated).toBe(0);
  });

  it("rejects non-positive maxChars", () => {
    expect(() => createToolTruncationMiddleware({ maxChars: 0 })).toThrow("maxChars must be positive");
    expect(() => createToolTruncationMiddleware({ maxChars: -5 })).toThrow("maxChars must be positive");
  });
});
