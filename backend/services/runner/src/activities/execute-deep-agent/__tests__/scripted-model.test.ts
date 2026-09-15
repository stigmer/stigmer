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
 *     whose `args` is a JSON STRING, usage on `message-finish` (the cache
 *     buckets under `input_token_details`) — and the aggregated streamed
 *     message equals the `invoke` message.
 *  5. A `TurnPlayer` script is asked with the whole transcript and its
 *     answer is played, whatever the round.
 *  6. A turn's ending takes the call: `fail` throws after the chunks; `hang`
 *     parks on the call's abort signal (reporting the park), throws the
 *     abort when it fires, and refuses a call with no signal. On a REAL
 *     deepagents graph aborted mid-hang through the run's own signal, the
 *     parked model unparks, the stream rejects with the abort, and the
 *     process sees no orphaned rejection — the posture the contract kit's
 *     hang arms and the runtime's stall watchdog rely on (S3 M2a F-M2a-18
 *     measured one orphan for a forced mid-step abort of a WEDGED engine;
 *     an engine that honours its signal leaves none, and this arm is where
 *     that fact is pinned).
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

import {
  ScriptedModel,
  completedToolRounds,
  type RoleScript,
  type ScriptedTurnInfo,
  type TurnPlayer,
} from "../__test-utils__/scripted-model.js";

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

  it("reports the role, the round and the calls it answers to onTurn before rendering", async () => {
    const seen: ScriptedTurnInfo[] = [];
    const model = new ScriptedModel(() => script, [], { onTurn: (info) => void seen.push(info) });
    const bound = model.bindTools([{ name: "probe" }]);
    await bound.invoke(transcriptWithRounds(2));
    // The prior calls are the LAST AI message's — the results this turn
    // answers — read from the transcript, not the script.
    expect(seen).toEqual([{ boundToolNames: ["probe"], round: 2, priorToolCallIds: ["call_1"] }]);
  });

  it("reports no prior calls on a first turn or after a text-only turn", async () => {
    const seen: ScriptedTurnInfo[] = [];
    const model = new ScriptedModel(() => script, [], { onTurn: (info) => void seen.push(info) });
    await model.invoke(transcriptWithRounds(0));
    await model.invoke([...transcriptWithRounds(1), new AIMessage("a text-only turn"), new HumanMessage("more")]);
    expect(seen.map((s) => s.priorToolCallIds)).toEqual([[], []]);
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

  it("puts the cache buckets under input_token_details on message-finish, the Anthropic adapter's shape", async () => {
    const model = new ScriptedModel(() => ({
      turns: [{ text: "cached", usage: { inputTokens: 30, outputTokens: 4, cacheReadTokens: 20, cacheWriteTokens: 5 } }],
    }));
    let finish: { usage?: Record<string, unknown> } | undefined;
    for await (const ev of model.streamEvents(transcriptWithRounds(0))) {
      if ((ev as { event: string }).event === "message-finish") finish = ev as typeof finish;
    }
    expect(finish?.usage).toEqual({
      input_tokens: 30,
      output_tokens: 4,
      total_tokens: 34,
      input_token_details: { cache_read: 20, cache_creation: 5 },
    });
  });
});

describe("ScriptedModel — a TurnPlayer script reads the transcript itself", () => {
  it("is asked with the whole transcript and its turn is played whatever the round", async () => {
    const asked: number[] = [];
    const player: TurnPlayer = (transcript) => {
      asked.push(transcript.length);
      return { text: `saw ${transcript.length} messages` };
    };
    const model = new ScriptedModel(() => player);
    expect((await model.invoke(transcriptWithRounds(0))).content).toBe("saw 2 messages");
    expect((await model.invoke(transcriptWithRounds(3))).content).toBe("saw 8 messages");
    expect(asked).toEqual([2, 8]);
  });
});

describe("ScriptedModel — a turn's ending takes the call", () => {
  const boom = new Error("Engine rejected the request: invalid API key");

  it("fail: streams the turn's chunks, never finishes the message, then throws the error", async () => {
    const model = new ScriptedModel(() => ({ turns: [{ text: "Checking.", ends: { kind: "fail", error: boom } }] }));
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const ev of model.streamEvents(transcriptWithRounds(0))) seen.push((ev as { event: string }).event);
      })(),
    ).rejects.toBe(boom);
    expect(seen).toContain("content-block-delta");
    expect(seen, "an ending turn never reaches message-finish").not.toContain("message-finish");
    await expect(model.invoke(transcriptWithRounds(0)), "invoke ends the same way").rejects.toBe(boom);
  });

  it("hang: refuses a call that carries no abort signal, diagnosing", async () => {
    const model = new ScriptedModel(() => ({ turns: [{ ends: { kind: "hang" } }] }));
    await expect(model.invoke(transcriptWithRounds(0))).rejects.toThrow(/parks on the call's abort signal and this call carried none/);
  });

  it("hang: parks after its chunks, reports the park, and throws the abort when the signal fires", async () => {
    let parked = false;
    const model = new ScriptedModel(() => ({ turns: [{ text: "Working…", ends: { kind: "hang" } }] }), [], { onPark: () => (parked = true) });
    const controller = new AbortController();
    const seen: string[] = [];
    const consumed = (async () => {
      for await (const ev of model.streamEvents(transcriptWithRounds(0), { signal: controller.signal })) {
        seen.push((ev as { event: string }).event);
      }
    })();
    await waitUntil(() => parked);
    expect(seen, "the text reached the consumer before the park").toContain("content-block-delta");
    controller.abort("stopped by the runtime");
    await expect(consumed).rejects.toThrow(/stopped by the runtime/);
  });

  it("hang on a REAL graph: the run's abort signal unparks the model, the stream rejects, and no rejection is orphaned", async () => {
    let parked = false;
    const model = new ScriptedModel(() => ({ turns: [{ text: "Working…", ends: { kind: "hang" } }] }), [], { onPark: () => (parked = true) });
    const agent = await createDeepAgent({
      model,
      checkpointer: new MemorySaver() as never,
      backend: new StateBackend(),
    } as unknown as Parameters<typeof createDeepAgent>[0]);
    const controller = new AbortController();
    const orphans: unknown[] = [];
    const onOrphan = (reason: unknown): void => void orphans.push(reason);
    process.on("unhandledRejection", onOrphan);
    try {
      const run = await agent.streamEvents(
        { messages: [new HumanMessage("go")] },
        { configurable: { thread_id: "hang-probe" }, version: "v3", signal: controller.signal },
      );
      const consumed = (async () => {
        let events = 0;
        for await (const _event of run) events += 1;
        return events;
      })();
      await waitUntil(() => parked);
      controller.abort("stopped by the runtime");
      await expect(consumed, "the aborted run rejects out of the pull").rejects.toThrow();
      // Give any orphan the macrotask turns it needs to surface as unhandled.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(orphans, "an engine that honours its signal leaves no orphaned rejection behind").toEqual([]);
    } finally {
      process.off("unhandledRejection", onOrphan);
    }
  });
});

/** Poll a predicate on the microtask/macrotask boundary — never a fixed sleep. */
async function waitUntil(ready: () => boolean, budgetMs = 5_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error("waitUntil: the condition did not become true in time");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
