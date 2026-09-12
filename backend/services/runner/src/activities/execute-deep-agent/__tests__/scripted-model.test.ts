/**
 * The scripted model's own contract: the properties every consumer of
 * `__test-utils__/scripted-model.ts` leans on, pinned here so a change to the
 * double is caught before it silently reshapes a golden.
 *
 *  1. The two-turn sugar `{ toolCalls, done }` means exactly "propose on round
 *     0, say `done` on every round after".
 *  2. A turn is chosen by the transcript's completed tool rounds, never by a
 *     call counter: the same instance answers a fresh thread and a resumed
 *     thread identically (the memory-replay vs sqlite-resume equivalence the
 *     hermetic HITL arms depend on), and one instance drives two whole graph
 *     runs to the same result.
 *  3. Running out of script throws with a diagnosing message; `repeatLast`
 *     keeps playing the final turn.
 *  4. Streaming produces the production event sequence: reasoning as an
 *     opener plus a delta, text as a delta, a tool call as a `tool_call_chunk`
 *     whose `args` is a JSON STRING, usage on `message-finish` — and the
 *     aggregated streamed message equals the `invoke` message.
 */

import { describe, expect, it } from "vitest";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { MemorySaver } from "@langchain/langgraph";
import { createDeepAgent, StateBackend } from "deepagents";

import { ScriptedModel, completedToolRounds, type RoleScript, type ScriptedTurnInfo } from "../__test-utils__/scripted-model.js";

const CALL = { name: "probe", args: { path: "a.txt" }, id: "call_1" };

function transcriptWithRounds(rounds: number): BaseMessage[] {
  const out: BaseMessage[] = [new SystemMessage("sys"), new HumanMessage("go")];
  for (let i = 0; i < rounds; i++) {
    out.push(new AIMessage({ content: "", tool_calls: [{ ...CALL, id: `call_${i}`, type: "tool_call" }] }));
    out.push(new ToolMessage({ content: "ok", tool_call_id: `call_${i}` }));
  }
  return out;
}

describe("ScriptedModel — the two-turn sugar", () => {
  it("proposes on round 0 and says done on every later round", async () => {
    const model = new ScriptedModel(() => ({ toolCalls: [CALL], done: "finished" }));

    const first = await model.invoke(transcriptWithRounds(0));
    expect(first.tool_calls?.map((tc) => tc.name)).toEqual(["probe"]);
    expect(first.content).toBe("");

    const second = await model.invoke(transcriptWithRounds(1));
    expect(second.tool_calls ?? []).toHaveLength(0);
    expect(second.content).toBe("finished");

    const third = await model.invoke(transcriptWithRounds(2));
    expect(third.content, "the sugar repeats its last turn").toBe("finished");
  });
});

describe("ScriptedModel — turns are indexed by the transcript, not by a counter", () => {
  const script: RoleScript = {
    turns: [{ toolCalls: [CALL] }, { toolCalls: [{ ...CALL, id: "call_b" }] }, { text: "done" }],
  };

  it("counts completed tool rounds from AI messages carrying tool_calls", () => {
    expect(completedToolRounds(transcriptWithRounds(0))).toBe(0);
    expect(completedToolRounds(transcriptWithRounds(2))).toBe(2);
    expect(completedToolRounds([new AIMessage("plain text, no tools")])).toBe(0);
  });

  it("answers the same transcript the same way regardless of what it was asked before", async () => {
    const model = new ScriptedModel(() => script);
    // A "resumed" thread asks round 1 first; a "replayed" thread asks 0 then 1.
    const resumed = await model.invoke(transcriptWithRounds(1));
    await model.invoke(transcriptWithRounds(0));
    const replayed = await model.invoke(transcriptWithRounds(1));
    expect(replayed.tool_calls).toEqual(resumed.tool_calls);
    expect(replayed.tool_calls?.[0]?.id).toBe("call_b");
  });

  it("reports the role and round to onTurn before rendering", async () => {
    const seen: ScriptedTurnInfo[] = [];
    const model = new ScriptedModel(() => script, [], { onTurn: (info) => void seen.push(info) });
    const bound = model.bindTools([{ name: "probe" }]);
    await bound.invoke(transcriptWithRounds(2));
    expect(seen).toEqual([{ boundToolNames: ["probe"], round: 2 }]);
  });

  it("throws a diagnosing error when the script runs out", async () => {
    const model = new ScriptedModel(() => script).bindTools([{ name: "probe" }, { name: "task" }]);
    await expect(model.invoke(transcriptWithRounds(3))).rejects.toThrow(
      /role \[probe, task\] has 3 turn\(s\) but the transcript already holds 3 completed tool round\(s\)/,
    );
  });

  it("repeats the final turn when repeatLast is set", async () => {
    const model = new ScriptedModel(() => ({ turns: [{ toolCalls: [CALL] }], repeatLast: true }));
    const late = await model.invoke(transcriptWithRounds(7));
    expect(late.tool_calls?.map((tc) => tc.name)).toEqual(["probe"]);
  });

  it("drives two whole graph runs from one instance to the same result", async () => {
    let executions = 0;
    const probe = tool(
      async () => {
        executions += 1;
        return "ok";
      },
      { name: "probe", description: "probe", schema: z.object({ path: z.string() }) },
    );
    const model = new ScriptedModel(() => ({ toolCalls: [CALL], done: "all done" }));
    const runOnce = async (threadId: string): Promise<string> => {
      const agent = await createDeepAgent({
        model,
        checkpointer: new MemorySaver() as never,
        backend: new StateBackend(),
        tools: [probe],
      } as unknown as Parameters<typeof createDeepAgent>[0]);
      const result = (await agent.invoke(
        { messages: [new HumanMessage("go")] },
        { configurable: { thread_id: threadId }, recursionLimit: 50 },
      )) as { messages: BaseMessage[] };
      const last = result.messages[result.messages.length - 1];
      return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
    };

    expect(await runOnce("thread-a")).toBe("all done");
    expect(await runOnce("thread-b")).toBe("all done");
    expect(executions, "one tool execution per run").toBe(2);
  });
});

describe("ScriptedModel — streaming is the production event path", () => {
  const turn = {
    reasoning: "Let me think.",
    text: "Reading the file.",
    toolCalls: [CALL],
    usage: { inputTokens: 1_000, outputTokens: 40 },
  };

  it("emits opener + delta for reasoning, a text delta, a JSON-string tool_call_chunk, and usage on finish", async () => {
    const model = new ScriptedModel(() => ({ turns: [turn] }));
    const events: Array<Record<string, unknown>> = [];
    for await (const ev of model.streamEvents(transcriptWithRounds(0))) {
      events.push(ev as unknown as Record<string, unknown>);
    }
    const kinds = events.map((e) => e.event);
    expect(kinds[0]).toBe("message-start");
    expect(kinds.at(-1)).toBe("message-finish");

    const deltas = events.filter((e) => e.event === "content-block-delta").map((e) => e.delta as Record<string, unknown>);
    expect(deltas.map((d) => d.type)).toEqual(["reasoning-delta", "text-delta", "block-delta"]);
    expect(deltas[0].reasoning).toBe("Let me think.");
    expect(deltas[1].text).toBe("Reading the file.");
    const fields = deltas[2].fields as Record<string, unknown>;
    expect(fields.type).toBe("tool_call_chunk");
    expect(fields.id).toBe("call_1");
    expect(fields.name).toBe("probe");
    expect(fields.args, "args ride the stream as a JSON string, as every provider sends them").toBe(
      JSON.stringify(CALL.args),
    );

    const start = events[0] as { usage?: unknown };
    expect(start.usage, "usage never rides message-start").toBeUndefined();
    const finish = events.at(-1) as { usage?: { input_tokens: number; output_tokens: number; total_tokens: number } };
    expect(finish.usage).toEqual({ input_tokens: 1_000, output_tokens: 40, total_tokens: 1_040 });
  });

  it("aggregates the streamed chunks to the message invoke returns", async () => {
    const model = new ScriptedModel(() => ({ turns: [turn] }));
    const invoked = await model.invoke(transcriptWithRounds(0));
    let streamed: AIMessageChunk | undefined;
    for await (const chunk of await model.stream(transcriptWithRounds(0))) {
      streamed = streamed ? streamed.concat(chunk) : chunk;
    }
    expect(streamed).toBeDefined();
    expect(streamed!.tool_calls?.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args }))).toEqual(
      invoked.tool_calls?.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args })),
    );
    expect(streamed!.text).toBe(invoked.text);
    // Core's chunk merge adds empty `*_token_details` maps; the three counts the runner reads must agree.
    expect(streamed!.usage_metadata).toMatchObject(invoked.usage_metadata!);
  });

  it("keeps a plain-text turn as string content, the shape every provider gives", async () => {
    const model = new ScriptedModel(() => ({ turns: [{ text: "hello" }] }));
    const invoked = await model.invoke(transcriptWithRounds(0));
    expect(invoked.content).toBe("hello");
    let streamed: AIMessageChunk | undefined;
    for await (const chunk of await model.stream(transcriptWithRounds(0))) {
      streamed = streamed ? streamed.concat(chunk) : chunk;
    }
    expect(streamed!.content).toBe("hello");
  });
});
