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
import { createDeepAgent } from "deepagents";
import { describe, expect, it } from "vitest";

import { InputFileNotFoundError, type InputFileInfo, type TurnInputFiles } from "../../../shared/inputs-reader.js";
import { newOutputsBuffer } from "../../../shared/outputs-buffer.js";
import type { TurnOffloads } from "../../../shared/offload-store.js";
import { computerlessFileBackend, MAX_NOTE_BYTES, OFFLOAD_KEYS_ROOT } from "../computerless-files.js";
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
    const state = await graph.getState({ configurable: { thread_id: "thread-ses_1" } });
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
    const state = await graph.getState({ configurable: { thread_id: "thread-ses_1" } });
    const files = (state.values as { files: Record<string, { content: unknown }> }).files;
    expect(Object.keys(files)).toEqual([`${OFFLOAD_KEYS_ROOT}large_tool_results/call_1.txt`]);
    expect(JSON.stringify(files)).not.toContain("xxxxxxxxxx");

    const later = await turn(graph);
    expect(later.get("b")).toContain("xxxx");
  });

  it("refuses a note past its bound with a sentence", async () => {
    const layer = computerlessFileBackend({ inputs: inputs(), outputs: newOutputsBuffer() }, undefined);
    const graph = await graphOver(layer, [[call("big", "write_file", { file_path: "/big.md", content: "y".repeat(MAX_NOTE_BYTES + 1) })]]);
    const read = await turn(graph);
    expect(read.get("big")).toMatch(/Notes are kept with this conversation, up to 262144 bytes each/);
    expect(routesOffloads(layer), "without artifact storage nothing is set aside").toBe(false);
  });
});
