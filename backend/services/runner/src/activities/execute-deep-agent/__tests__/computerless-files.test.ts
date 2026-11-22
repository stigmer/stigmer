/**
 * The file layer of a conversation without a computer
 * (`../computerless-files.ts`), driven through a real deepagents graph with
 * a scripted model, so every path goes through the engine's own file tools:
 *
 *  - a note written in one turn is in the conversation's saved state and
 *    reads back in the next, on the same checkpointer;
 *  - an upload is read from the turn's reader when opened, and nothing else
 *    under `.stigmer/uploads/` exists;
 *  - an output lands in the runner's buffer, an earlier output reads
 *    through the reader, and an edit of it saves this turn's version;
 *  - a set-aside result is stored through the runner and only its key is
 *    kept in the state, readable in a later turn;
 *  - a path on the runner's disk is not found, whatever exists there;
 *  - the notes' budget refuses a note past either bound, with a sentence.
 */
import { HumanMessage, isToolMessage, type BaseMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createDeepAgent, StateBackend } from "deepagents";
import { describe, expect, it } from "vitest";

import { InputFileNotFoundError, NO_TURN_INPUTS, type InputFileInfo, type TurnInputFiles } from "../../../shared/inputs-reader.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import type { TurnHookSource, TurnInput } from "../../../harness/types.js";
import { buildHookEvaluator, HookSetupError } from "../hooks-setup.js";
import { newOutputsBuffer } from "../../../shared/outputs-buffer.js";
import type { TurnOffloads } from "../../../shared/offload-store.js";
import type { TurnArchiveFiles } from "../../../shared/archive-reader.js";
import { computerlessFileBackend, MAX_NOTE_BYTES, NotesBackend, OFFLOAD_KEYS_ROOT } from "../computerless-files.js";
import { routesOffloads } from "../platform-route.js";
import { ScriptedModel, type ScriptedToolCall } from "../__test-utils__/scripted-model.js";

const UPLOAD = "brief from the customer\n";
const EARLIER = "# Reply v1\nDear customer,\n";

function inputs(): TurnInputFiles {
  const files = new Map<string, Uint8Array>([
    ["uploads/brief.txt", new TextEncoder().encode(UPLOAD)],
    ["outputs/reply.md", new TextEncoder().encode(EARLIER)],
  ]);
  return {
    list: async () =>
      [...files].map(([path, bytes]): InputFileInfo => ({ path, size: bytes.length, fileId: `file_${path}`, mimeType: "text/plain" })),
    read: async (path) => {
      const bytes = files.get(path);
      if (bytes === undefined) throw new InputFileNotFoundError(path);
      return bytes;
    },
  };
}

function offloads(): TurnOffloads & { readonly stored: Map<string, Uint8Array> } {
  const stored = new Map<string, Uint8Array>();
  return {
    stored,
    put: async (bytes) => {
      const key = `artifacts/run_1/offloads/ses_1/${String(stored.size).padStart(64, "0")}`;
      stored.set(key, bytes);
      return key;
    },
    read: async (key) => {
      const bytes = stored.get(key);
      if (bytes === undefined) throw new Error(`no such key ${key}`);
      return bytes;
    },
  };
}

/** One graph turn: the model plays its next script step, one round, then ends; the tool messages, by call id. */
async function turn(graph: Awaited<ReturnType<typeof createDeepAgent>>): Promise<Map<string, string>> {
  const result = (await graph.invoke(
    { messages: [new HumanMessage({ content: "go on" })] },
    { configurable: { thread_id: "thread-ses_1" }, recursionLimit: 20 },
  )) as { messages: BaseMessage[] };
  const read = new Map<string, string>();
  for (const message of result.messages) {
    if (isToolMessage(message)) read.set(message.tool_call_id, typeof message.content === "string" ? message.content : JSON.stringify(message.content));
  }
  return read;
}

/** A graph over the layer whose model plays `script` in order, one round per turn, then answers "done". */
async function graphOver(layer: ReturnType<typeof computerlessFileBackend>, script: readonly (readonly ScriptedToolCall[])[], saver = new MemorySaver()) {
  let played = 0;
  const model = new ScriptedModel(() => (transcript: readonly BaseMessage[]) => {
    const last = transcript[transcript.length - 1];
    if (last !== undefined && isToolMessage(last)) return { text: "done" };
    const calls = script[played++] ?? [];
    return calls.length === 0 ? { text: "done" } : { toolCalls: calls };
  });
  return createDeepAgent({ model, checkpointer: saver as never, systemPrompt: "work", backend: layer } as Parameters<typeof createDeepAgent>[0]);
}

const call = (id: string, name: string, args: Record<string, unknown>): ScriptedToolCall => ({ id, name, args });

describe("the file layer without a computer", () => {
  it("keeps notes in the saved state across turns, reads uploads and earlier outputs, and buffers this turn's outputs", async () => {
    const buffer = newOutputsBuffer();
    const layer = computerlessFileBackend({ inputs: inputs(), outputs: buffer, offloads: offloads() }, undefined);
    const graph = await graphOver(layer, [
      [
        call("w1", "write_file", { file_path: "/notes.md", content: "remember the deadline\n" }),
        call("r1", "read_file", { file_path: "/.stigmer/uploads/brief.txt" }),
        call("e1", "edit_file", { file_path: "/.stigmer/outputs/reply.md", old_string: "Reply v1", new_string: "Reply v2" }),
      ],
      [call("r2", "read_file", { file_path: "/notes.md" })],
    ]);

    const first = await turn(graph);
    expect(first.get("r1")).toContain("brief from the customer");
    expect((await buffer.read("reply.md")) && Buffer.from((await buffer.read("reply.md"))!).toString("utf8")).toBe("# Reply v2\nDear customer,\n");

    const second = await turn(graph);
    expect(second.get("r2"), "the note written in turn 1 reads back in turn 2").toContain("remember the deadline");
    const state = (await graph.getState({ configurable: { thread_id: "thread-ses_1" } })) as { values: unknown };
    expect(Object.keys((state.values as { files: Record<string, unknown> }).files)).toEqual(["/notes.md"]);
  });

  it("finds nothing on the runner's disk and nothing it was not handed", async () => {
    const layer = computerlessFileBackend({ inputs: inputs(), outputs: newOutputsBuffer() }, undefined);
    const graph = await graphOver(layer, [
      [
        call("h", "read_file", { file_path: "/etc/hosts" }),
        call("p", "read_file", { file_path: "/.stigmer/uploads/other-conversation.pdf" }),
        call("l", "ls", { path: "/" }),
      ],
    ]);
    const read = await turn(graph);
    expect(read.get("h")).toMatch(/not found/i);
    expect(read.get("p")).toMatch(/no such file|not found/i);
    expect(read.get("l")).not.toMatch(/etc|usr|home/);
  });

  it("sets a long result aside through the runner, keeps only its key, and reads it back in a later turn", async () => {
    const store = offloads();
    const layer = computerlessFileBackend({ inputs: inputs(), outputs: newOutputsBuffer(), offloads: store }, undefined);
    expect(routesOffloads(layer), "the truncation keeper writes through this layer").toBe(true);
    const long = "x".repeat(50_000);
    const graph = await graphOver(layer, [
      [call("o", "write_file", { file_path: "/large_tool_results/call_1.txt", content: long })],
      [call("b", "read_file", { file_path: "/large_tool_results/call_1.txt", limit: 1 })],
    ]);
    await turn(graph);
    expect([...store.stored.values()].map((bytes) => bytes.length)).toEqual([50_000]);
    const state = (await graph.getState({ configurable: { thread_id: "thread-ses_1" } })) as { values: unknown };
    const files = (state.values as { files: Record<string, { content: unknown }> }).files;
    expect(Object.keys(files)).toEqual([`${OFFLOAD_KEYS_ROOT}large_tool_results/call_1.txt`]);
    expect(JSON.stringify(files)).not.toContain("xxxxxxxxxx");

    const later = await turn(graph);
    expect(later.get("b")).toContain("xxxx");
  });

  it("holds all of a conversation's notes to their budget in UTF-8 bytes, a note in another script included", async () => {
    const layer = computerlessFileBackend({ inputs: inputs(), outputs: newOutputsBuffer() }, undefined);
    // 87,000 characters of three UTF-8 bytes each: 261,000 bytes, under a
    // note's bound; four fit the budget, a fifth does not. Counted in
    // UTF-16 units, the fifth would pass at about 435,000.
    const wide = "字".repeat(87_000);
    const graph = await graphOver(layer, [1, 2, 3, 4, 5].map((n) => [call(`w${n}`, "write_file", { file_path: `/note-${n}.md`, content: wide })]));
    const answers: string[] = [];
    for (let n = 1; n <= 5; n += 1) answers.push((await turn(graph)).get(`w${n}`) ?? "");
    expect(answers.slice(0, 4).every((answer) => !answer.includes("Error")), answers.slice(0, 4).join(" | ")).toBe(true);
    expect(answers[4]).toMatch(/over the 1048576-byte budget/);
  });

  it("holds an edit to a note's bound", async () => {
    const layer = computerlessFileBackend({ inputs: inputs(), outputs: newOutputsBuffer() }, undefined);
    const graph = await graphOver(layer, [
      [call("w", "write_file", { file_path: "/grow.md", content: "seed\n" })],
      [call("e", "edit_file", { file_path: "/grow.md", old_string: "seed", new_string: "y".repeat(MAX_NOTE_BYTES) })],
    ]);
    await turn(graph);
    expect((await turn(graph)).get("e")).toMatch(/up to 262144 bytes each/);
  });

  it("refuses a note past its bound with a sentence", async () => {
    const layer = computerlessFileBackend({ inputs: inputs(), outputs: newOutputsBuffer() }, undefined);
    const graph = await graphOver(layer, [[call("big", "write_file", { file_path: "/big.md", content: "y".repeat(MAX_NOTE_BYTES + 1) })]]);
    const read = await turn(graph);
    expect(read.get("big")).toMatch(/Notes are kept with this conversation, up to 262144 bytes each/);
    expect(routesOffloads(layer), "without artifact storage nothing is set aside").toBe(false);
  });
});

describe("the file layer without a computer — its refusals, read directly", () => {
  const layer = () => {
    const buffer = newOutputsBuffer();
    return { buffer, backend: computerlessFileBackend({ inputs: inputs(), outputs: buffer }, undefined) };
  };

  it("keeps the outputs folder and the person's earlier Files, and refuses what the server would not take", async () => {
    const { buffer, backend } = layer();
    expect((await backend.write("/.stigmer/outputs/new.md", "fresh")).error).toBeUndefined();
    expect((await backend.ls("/.stigmer/outputs")).files?.map((file) => file.path).sort()).toEqual(["/.stigmer/outputs/new.md", "/.stigmer/outputs/reply.md"]);
    expect((await backend.delete("/.stigmer/outputs/new.md")).error).toBeUndefined();
    expect(await buffer.read("new.md")).toBeUndefined();
    expect((await backend.delete("/.stigmer/outputs/reply.md")).error).toMatch(/returned to the person in an earlier turn/);
    expect((await backend.delete("/.stigmer/outputs/missing.md")).error).toMatch(/not found/);
    expect((await backend.delete("/.stigmer/outputs")).error).toMatch(/is the outputs folder and stays/);
    expect((await backend.write("/.stigmer/outputs/a\\b.md", "x")).error).toMatch(/not a path inside the outputs folder/);
    expect((await backend.write("/.stigmer/outputs/huge.bin", "z".repeat(8 * 1024 * 1024 + 1))).error).toMatch(/up to 8388608 bytes each/);
    expect((await backend.edit("/.stigmer/outputs/missing.md", "a", "b")).error).toMatch(/not found/);
    expect((await backend.edit("/.stigmer/outputs/reply.md", "absent text", "b")).error).toMatch(/String not found/);
    expect((await backend.uploadFiles([["/.stigmer/outputs/u.bin", new Uint8Array([1])]]))[0]?.error).toBe("permission_denied");
  });

  it("keeps the conversation's Files and the rest of .stigmer read-only, and finds nothing else there", async () => {
    const { backend } = layer();
    expect((await backend.write("/.stigmer/uploads/brief.txt", "x")).error).toMatch(/read-only/);
    expect((await backend.write("/.stigmer/elsewhere.txt", "x")).error).toMatch(/read-only/);
    expect((await backend.read("/.stigmer/elsewhere.txt")).error).toMatch(/no such file/);
    expect((await backend.ls("/.stigmer/inputs")).files).toEqual([]);
  });

  it("refuses to keep a long result on a runner without storage, and never as a note", async () => {
    const { backend } = layer();
    expect((await backend.write("/large_tool_results/call_1.txt", "long")).error).toMatch(/no storage to set results aside in/);
    expect((await backend.write("/conversation_history/t.md", "long")).error).toMatch(/no storage to set results aside in/);
  });

  it("refuses an edit or a delete of a set-aside result, and says why a store failure kept nothing", async () => {
    const failing: TurnOffloads = {
      put: async () => Promise.reject(new Error("bucket unreachable")),
      read: async () => new Uint8Array(),
    };
    const backend = computerlessFileBackend({ inputs: inputs(), outputs: newOutputsBuffer(), offloads: failing }, undefined);
    expect((await backend.edit("/large_tool_results/x.txt", "a", "b")).error).toMatch(/read-only/);
    expect((await backend.delete("/large_tool_results/x.txt")).error).toMatch(/stays/);
    expect((await backend.write("/large_tool_results/x.txt", "long")).error).toMatch(/could not be set aside: bucket unreachable/);
  });
});

describe("the engine's hooks without a computer", () => {
  it("refuses a turn that still carries a hook, and runs one that carries none", async () => {
    const sink = { stopSignal: new AbortController().signal, recordActivity: () => {} };
    const noComputer = (hooks?: TurnInput["hooks"]): TurnInput => ({
      ...turnInputFixture(),
      workspace: { computer: false, files: { inputs: NO_TURN_INPUTS, outputs: newOutputsBuffer() } },
      ...(hooks !== undefined && { hooks }),
    });
    expect(await buildHookEvaluator(noComputer(), sink, 1_000)).toBeNull();
    const hooked = noComputer({ sources: [{ format: "claude" } as unknown as TurnHookSource], serverNames: new Map() });
    await expect(buildHookEvaluator(hooked, sink, 1_000)).rejects.toBeInstanceOf(HookSetupError);
  });
});

describe("the notes, read directly over a saved state", () => {
  const fileData = (content: string) => ({ content, mimeType: "text/plain", created_at: "", modified_at: "" });
  const notesOver = (files: Record<string, unknown>) => new NotesBackend(new StateBackend({ state: { files } } as never));

  it("never shows, reads, edits or deletes a set-aside key, and refuses a path that is no note's", async () => {
    const notes = notesOver({
      "/plan.md": fileData("step one\nstep two\n"),
      [`${OFFLOAD_KEYS_ROOT}large_tool_results/call_1.txt`]: fileData("artifacts/run_1/offloads/ses_1/abc\n4"),
    });
    expect((await notes.ls("/")).files?.map((file) => file.path)).toEqual(["/plan.md"]);
    expect((await notes.glob("**")).files?.map((file) => file.path)).toEqual(["/plan.md"]);
    expect((await notes.grep("artifacts")).matches).toEqual([]);
    expect((await notes.grep("step")).matches?.map((match) => match.line)).toEqual([1, 2]);
    const key = `${OFFLOAD_KEYS_ROOT}large_tool_results/call_1.txt`;
    expect((await notes.read(key)).error).toMatch(/not found/);
    expect((await notes.readRaw(key)).error).toMatch(/not found/);
    expect((await notes.edit(key, "a", "b")).error).toMatch(/not found/);
    expect((await notes.delete(key)).error).toMatch(/not found/);
    expect((await notes.write(key, "x")).error).toMatch(/not a path for a note/);
    expect((await notes.write("relative.md", "x")).error).toMatch(/not a path for a note/);
    expect((await notes.read("/plan.md")).content).toContain("step one");
    expect((await notes.downloadFiles(["/plan.md", key, "/missing.md"])).map((answer) => answer.error)).toEqual([null, "file_not_found", "file_not_found"]);
    expect((await notes.uploadFiles([["/up.bin", new Uint8Array([1])]]))[0]?.error).toBe("permission_denied");
  });
});

describe("the file layer without a computer — the rest of its answers", () => {
  it("routes the turn's skills to the store reader", async () => {
    const archives: TurnArchiveFiles = {
      folders: ["skills"],
      list: async () => [{ path: "skills/notes/SKILL.md", size: 5, sha256: "", executable: false }],
      read: async () => new TextEncoder().encode("# Notes"),
    };
    const backend = computerlessFileBackend({ inputs: inputs(), outputs: newOutputsBuffer() }, archives);
    expect((await backend.read("/.stigmer/skills/notes/SKILL.md")).content).toContain("# Notes");
  });

  it("answers the rest of .stigmer as nothing, and refuses every change there", async () => {
    const backend = computerlessFileBackend({ inputs: inputs(), outputs: newOutputsBuffer() }, undefined);
    const at = "/.stigmer/elsewhere/x.txt";
    expect((await backend.ls("/.stigmer/elsewhere")).files).toEqual([]);
    expect((await backend.readRaw(at)).error).toMatch(/no such file/);
    expect((await backend.grep("x", "/.stigmer/elsewhere")).matches).toEqual([]);
    expect((await backend.glob("*", "/.stigmer/elsewhere")).files).toEqual([]);
    expect((await backend.edit(at, "a", "b")).error).toMatch(/read-only/);
    expect((await backend.delete(at)).error).toMatch(/read-only/);
    expect((await backend.uploadFiles([[at, new Uint8Array([1])]]))[0]?.error).toBe("permission_denied");
    expect((await backend.downloadFiles([at]))[0]?.error).toBe("file_not_found");
  });

  it("edits an output exactly as deepagents does, and answers a path the buffer refuses", async () => {
    const buffer = newOutputsBuffer();
    const backend = computerlessFileBackend({ inputs: inputs(), outputs: buffer }, undefined);
    await backend.write("/.stigmer/outputs/blank.md", "");
    expect((await backend.edit("/.stigmer/outputs/blank.md", "", "filled")).error).toBeUndefined();
    expect(Buffer.from((await buffer.read("blank.md"))!).toString()).toBe("filled");
    await backend.write("/.stigmer/outputs/twice.md", "a a");
    expect((await backend.edit("/.stigmer/outputs/twice.md", "a", "b")).error).toMatch(/multiple occurrences/);
    expect((await backend.delete("/.stigmer/outputs/a\\b.md")).error).toMatch(/not a path inside the outputs folder/);
    const failing = computerlessFileBackend(
      { inputs: inputs(), outputs: { ...buffer, write: () => Promise.reject(new Error("refused across the pipe")) } },
      undefined,
    );
    expect((await failing.write("/.stigmer/outputs/x.md", "x")).error).toBe("Error: refused across the pipe");
  });

  it("takes no upload at an offload root, and finds a result never set aside as not found", async () => {
    const store = offloads();
    const layer = computerlessFileBackend({ inputs: inputs(), outputs: newOutputsBuffer(), offloads: store }, undefined);
    expect((await layer.uploadFiles([["/large_tool_results/u.txt", new Uint8Array([1])]]))[0]?.error).toBe("permission_denied");
    const graph = await graphOver(layer, [[call("missing", "read_file", { file_path: "/large_tool_results/never.txt" })]]);
    expect((await turn(graph)).get("missing")).toMatch(/no such file|not found/i);
  });
});

describe("the notes, read directly over a saved state — changes", () => {
  const notesOver = (files: Record<string, unknown>) => new NotesBackend(new StateBackend({ state: { files } } as never));

  it("edits, rewrites and deletes a note, an older note's lines included", async () => {
    const notes = notesOver({
      "/plan.md": { content: "step one\n", mimeType: "text/plain", created_at: "", modified_at: "" },
      "/old.md": { content: ["line one", "line two"], created_at: "", modified_at: "" },
    });
    expect((await notes.edit("/plan.md", "one", "1")).error).toBeUndefined();
    expect((await notes.write("/plan.md", "rewritten\n")).error).toBeUndefined();
    expect((await notes.edit("/old.md", "two", "2")).error).toBeUndefined();
    expect((await notes.delete("/plan.md")).error).toBeUndefined();
  });
});
