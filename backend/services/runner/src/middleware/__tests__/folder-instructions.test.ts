/**
 * A folder's own instruction file on the first read beneath it
 * (`folder-instructions.ts`): what is attached, where, once in the model's
 * view, and what is left alone.
 *
 * Files are read through a real virtual-rooted `FilesystemBackend` over a
 * temporary tree; a tool call's request carries the state it is handed (the
 * graph's `messages`), a model call's the messages the model is sent.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage, ToolMessage, type MessageContent } from "@langchain/core/messages";
import { FilesystemBackend } from "deepagents";

import { FOLDER_INSTRUCTIONS_KEY, createFolderInstructionsMiddleware } from "../folder-instructions.js";
import { REPOSITORY_INSTRUCTIONS_TEXT } from "../../activities/execute-deep-agent/repository-instructions.js";
import type { ModelCallRequest, StigmerMiddleware, ToolCallRequest } from "../types.js";
import { buildMiddlewareStack } from "../index.js";
import { buildSubAgentMiddleware } from "../../activities/execute-deep-agent/subagent-wiring.js";

const ROOTS = ["/", "/app"];
const BOUND = 30_000;
const READ_RESULT = "     1\tconst x = 1;";

let base: string;
let workspace: string;
let backend: FilesystemBackend;

function write(relativePath: string, text: string): void {
  const path = join(workspace, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function middleware(): StigmerMiddleware {
  return createFolderInstructionsMiddleware({ backend, roots: ROOTS, maxChars: BOUND });
}

/** The model message proposing these calls, as the graph's state holds it. */
function proposing(...calls: ReadonlyArray<{ id: string; name?: string; path: string }>): AIMessage {
  return new AIMessage({
    id: `ai-${calls.map((call) => call.id).join("-")}`,
    content: "",
    tool_calls: calls.map((call) => ({ id: call.id, name: call.name ?? "read_file", args: { file_path: call.path } })),
  });
}

function request(id: string, path: string, state: Record<string, unknown>, name = "read_file"): ToolCallRequest {
  return { toolCall: { id, name, args: { file_path: path } }, tool: undefined, state, runtime: {} };
}

function readResult(id: string, content: MessageContent = [{ type: "text", text: READ_RESULT }], status?: "error"): ToolMessage {
  return new ToolMessage({ content, tool_call_id: id, name: "read_file", ...(status ? { status } : {}) });
}

async function call(mw: StigmerMiddleware, req: ToolCallRequest, result: ToolMessage = readResult(req.toolCall.id)): Promise<ToolMessage> {
  return (await mw.wrapToolCall!(req, async () => result)) as ToolMessage;
}

/** The model is handed `messages`: what a compaction left of the history, or all of it. */
async function modelCall(mw: StigmerMiddleware, messages: unknown[]): Promise<void> {
  const request: ModelCallRequest = { model: undefined, messages, state: { messages }, runtime: {} };
  await mw.wrapModelCall!(request, async () => new AIMessage("ok"));
}

function texts(message: ToolMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" ? (block as { text: string }).text : `[${block.type}]`)).join("|");
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "folder-instructions-"));
  workspace = join(base, "ws");
  mkdirSync(workspace);
  backend = new FilesystemBackend({ rootDir: workspace, virtualMode: true });
  write("AGENTS.md", "root notes\n");
  write("pkg/AGENTS.md", "pkg notes\n");
  write("pkg/sub/CLAUDE.md", "sub notes\n");
  write("pkg/sub/x.ts", "const x = 1;\n");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(base, { recursive: true, force: true });
});

describe("FolderInstructionsMiddleware", () => {
  it("attaches every folder's file between the root and the read, shallowest first, and records them", async () => {
    const state = { messages: [new HumanMessage("fix it"), proposing({ id: "r1", path: "/pkg/sub/x.ts" })] };
    const result = await call(middleware(), request("r1", "/pkg/sub/x.ts", state));
    const [read, notes] = result.content as Array<{ type: string; text: string }>;
    expect(read.text).toBe(READ_RESULT);
    expect(notes.text).toBe(
      `${REPOSITORY_INSTRUCTIONS_TEXT.folder("/pkg/")}\n\n<instructions path="/pkg/AGENTS.md">\npkg notes\n</instructions>\n\n` +
      `${REPOSITORY_INSTRUCTIONS_TEXT.folder("/pkg/sub/")}\n\n<instructions path="/pkg/sub/CLAUDE.md">\nsub notes\n</instructions>`,
    );
    expect(result.additional_kwargs[FOLDER_INSTRUCTIONS_KEY]).toEqual(["/pkg/AGENTS.md", "/pkg/sub/CLAUDE.md"]);
    expect(result.tool_call_id).toBe("r1");
    expect(console.log).toHaveBeenCalledWith("[REPO-INSTRUCTIONS] nested=2");
  });

  it("appends to a string result after a blank line", async () => {
    const state = { messages: [proposing({ id: "r1", path: "/pkg/x.ts" })] };
    const result = await call(middleware(), request("r1", "/pkg/x.ts", state), readResult("r1", READ_RESULT));
    expect(result.content).toBe(`${READ_RESULT}\n\n${REPOSITORY_INSTRUCTIONS_TEXT.folder("/pkg/")}\n\n<instructions path="/pkg/AGENTS.md">\npkg notes\n</instructions>`);
  });

  it("gives an image read a text block of its own", async () => {
    const state = { messages: [proposing({ id: "r1", path: "/pkg/logo.png" })] };
    const image = readResult("r1", [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }]);
    const result = await call(middleware(), request("r1", "/pkg/logo.png", state), image);
    expect(texts(result)).toBe(`[image]|${REPOSITORY_INSTRUCTIONS_TEXT.folder("/pkg/")}\n\n<instructions path="/pkg/AGENTS.md">\npkg notes\n</instructions>`);
  });

  it("attaches nothing to a read directly in a root: the root's file is the system prompt's", async () => {
    const state = { messages: [proposing({ id: "r1", path: "/README.md" })] };
    const result = readResult("r1");
    expect(await call(middleware(), request("r1", "/README.md", state), result)).toBe(result);
  });

  it("never walks a routed prefix", async () => {
    write(".stigmer/skills/AGENTS.md", "platform\n");
    write("large_tool_results/AGENTS.md", "offload\n");
    const mw = middleware();
    for (const path of ["/.stigmer/skills/deploy/SKILL.md", "/large_tool_results/call.txt"]) {
      const state = { messages: [proposing({ id: "r1", path })] };
      const result = readResult("r1");
      expect(await call(mw, request("r1", path, state), result)).toBe(result);
    }
  });

  it("leaves a failed read alone, whether deepagents words it or the scope refuses it", async () => {
    const mw = middleware();
    const state = { messages: [proposing({ id: "r1", path: "/pkg/missing.ts" })] };
    const worded = readResult("r1", [{ type: "text", text: "Error: File '/pkg/missing.ts' not found" }]);
    expect(await call(mw, request("r1", "/pkg/missing.ts", state), worded)).toBe(worded);
    const refused = readResult("r1", "The agent's tool lists exclude read_file.", "error");
    expect(await call(mw, request("r1", "/pkg/missing.ts", state), refused)).toBe(refused);
  });

  it("attaches nothing to other tools", async () => {
    const state = { messages: [proposing({ id: "g1", name: "grep", path: "/pkg/sub/x.ts" })] };
    const result = readResult("g1");
    expect(await call(middleware(), request("g1", "/pkg/sub/x.ts", state, "grep"), result)).toBe(result);
  });

  it("shows a folder's file once while the model still sees it", async () => {
    const mw = middleware();
    const first = await call(mw, request("r1", "/pkg/x.ts", { messages: [proposing({ id: "r1", path: "/pkg/x.ts" })] }));
    const plain = readResult("r0", "an earlier result carrying no notes");
    const state = { messages: [plain, proposing({ id: "r1", path: "/pkg/x.ts" }), first, proposing({ id: "r2", path: "/pkg/sub/x.ts" })] };
    const second = await call(mw, request("r2", "/pkg/sub/x.ts", state));
    expect(second.additional_kwargs[FOLDER_INSTRUCTIONS_KEY]).toEqual(["/pkg/sub/CLAUDE.md"]);
    expect(texts(second)).not.toContain("pkg notes");
  });

  it("shows it again once the messages the model is handed no longer carry it, as after a compaction", async () => {
    const mw = middleware();
    const first = await call(mw, request("r1", "/pkg/x.ts", { messages: [proposing({ id: "r1", path: "/pkg/x.ts" })] }));
    const history = [new HumanMessage("go"), proposing({ id: "r1", path: "/pkg/x.ts" }), first, proposing({ id: "r2", path: "/pkg/y.ts" })];
    const summary = new HumanMessage({ content: "Summary", additional_kwargs: { lc_source: "summarization" } });

    await modelCall(mw, [summary, ...history.slice(2)]);
    const kept = await call(mw, request("r2", "/pkg/y.ts", { messages: history }));
    expect(kept.additional_kwargs[FOLDER_INSTRUCTIONS_KEY], "the model was handed the carrying message").toBeUndefined();

    await modelCall(mw, [summary, history[3]]);
    const again = await call(mw, request("r2", "/pkg/y.ts", { messages: history }));
    expect(again.additional_kwargs[FOLDER_INSTRUCTIONS_KEY], "the history still holds it; the model no longer sees it").toEqual(["/pkg/AGENTS.md"]);
  });

  it("decides against the whole history before any model call, so it never shows a file twice", async () => {
    const mw = middleware();
    const first = await call(mw, request("r1", "/pkg/x.ts", { messages: [proposing({ id: "r1", path: "/pkg/x.ts" })] }));
    // A fresh middleware is a turn resumed in a new process: its tool calls re-run before any model call.
    const resumed = await call(middleware(), request("r2", "/pkg/y.ts", { messages: [first, proposing({ id: "r2", path: "/pkg/y.ts" })] }));
    expect(resumed.additional_kwargs[FOLDER_INSTRUCTIONS_KEY]).toBeUndefined();
  });

  it("attaches a folder's file to one of two reads beneath it in one response", async () => {
    const mw = middleware();
    const state = { messages: [proposing({ id: "a", path: "/pkg/a.ts" }, { id: "b", path: "/pkg/b.ts" })] };
    const results = await Promise.all([call(mw, request("a", "/pkg/a.ts", state)), call(mw, request("b", "/pkg/b.ts", state))]);
    const carried = results.map((result) => result.additional_kwargs[FOLDER_INSTRUCTIONS_KEY]);
    expect(carried.filter((paths) => paths !== undefined)).toEqual([["/pkg/AGENTS.md"]]);
  });

  it("finds a call's model message past later messages, and keys a call no model message holds by its own id", async () => {
    const mw = middleware();
    const held = { messages: [proposing({ id: "a", path: "/pkg/a.ts" }), new HumanMessage("a message sent while the turn works")] };
    expect((await call(mw, request("a", "/pkg/a.ts", held))).additional_kwargs[FOLDER_INSTRUCTIONS_KEY]).toEqual(["/pkg/AGENTS.md"]);
    const unheld = { messages: [new HumanMessage("no proposing message")] };
    const results = await Promise.all([call(mw, request("x", "/pkg/a.ts", unheld)), call(mw, request("y", "/pkg/b.ts", unheld))]);
    expect(results.map((r) => r.additional_kwargs[FOLDER_INSTRUCTIONS_KEY]), "each its own response").toEqual([["/pkg/AGENTS.md"], ["/pkg/AGENTS.md"]]);
  });

  it("claims afresh for the next response", async () => {
    const mw = middleware();
    await call(mw, request("a", "/pkg/a.ts", { messages: [proposing({ id: "a", path: "/pkg/a.ts" })] }));
    // The next response's state lost the carrying message (a fresh conversation over the same middleware).
    const next = await call(mw, request("b", "/pkg/b.ts", { messages: [proposing({ id: "b", path: "/pkg/b.ts" })] }));
    expect(next.additional_kwargs[FOLDER_INSTRUCTIONS_KEY]).toEqual(["/pkg/AGENTS.md"]);
  });

  it("leaves the read untouched when discovery fails", async () => {
    const state = Object.defineProperty({}, "messages", { get: () => { throw new Error("state unreadable"); } }) as Record<string, unknown>;
    const result = readResult("r1");
    expect(await call(middleware(), request("r1", "/pkg/x.ts", state), result)).toBe(result);
  });

  it("passes a handler's throw through", async () => {
    const mw = middleware();
    await expect(mw.wrapToolCall!(request("r1", "/pkg/x.ts", { messages: [] }), async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});

describe("its place in the stacks", () => {
  /** The names around tool truncation: folder instructions sit directly outside it, so the notes are never cut. */
  function aroundTruncation(names: readonly string[]): readonly string[] {
    const at = names.indexOf("ToolTruncationMiddleware");
    return names.slice(at - 1, at + 1);
  }

  it("sits directly outside truncation on the parent, and only when configured", () => {
    const config = { backend, roots: ROOTS, maxChars: BOUND };
    const names = buildMiddlewareStack({ folderInstructions: config }).middleware.map((m) => m.name);
    expect(aroundTruncation(names)).toEqual(["FolderInstructionsMiddleware", "ToolTruncationMiddleware"]);
    expect(buildMiddlewareStack({}).middleware.map((m) => m.name)).not.toContain("FolderInstructionsMiddleware");
    expect(buildMiddlewareStack({ folderInstructions: null }).middleware.map((m) => m.name)).not.toContain("FolderInstructionsMiddleware");
  });

  it("sits directly outside truncation in a sub-agent, and only when configured", () => {
    const names = buildSubAgentMiddleware({ folderInstructions: { backend, roots: ROOTS, maxChars: BOUND } }).map((m) => m.name);
    expect(aroundTruncation(names)).toEqual(["FolderInstructionsMiddleware", "ToolTruncationMiddleware"]);
    expect(buildSubAgentMiddleware().map((m) => m.name)).not.toContain("FolderInstructionsMiddleware");
  });
});
