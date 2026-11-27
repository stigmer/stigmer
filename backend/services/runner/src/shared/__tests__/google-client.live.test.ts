/**
 * Live: LangChain's Google client, as the runner builds it, against Google
 * itself: the vendor facts the Gemini fake (`google-client.test.ts`) is
 * written from, and that only Google can confirm.
 *
 *  - Google signs a function call, and accepts the signature the client sends
 *    back after the reply was streamed as the agent loop streams it and the
 *    tool-calling message went through a checkpoint at an approval pause.
 *  - The usage on the stream's `message-finish` counts the thinking as output
 *    (the runner's model adds it to the client's count).
 *  - A forced function call (structured output) is answered with thinking on.
 *  - A wrong key is refused with 400 and `API_KEY_INVALID`, and reads as the
 *    key's fault.
 *
 * Every prompt is test text. Live class (`*.live.test.ts`): runs only through
 * `npm run test:live`, by hand or in the live lane; skips without
 * `GEMINI_API_KEY` outside the lane (`src/__test-utils__/live-gate.ts`).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { Command } from "@langchain/langgraph";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { createAgent, humanInTheLoopMiddleware, tool } from "langchain";
import { z } from "zod";
import { ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { liveSecret, useProviderDirectly } from "../../__test-utils__/live-gate.js";
import { stubRegistryFetch } from "../../__test-utils__/model-registry-fixture.js";
import { usageOf, type V3UsagePayload } from "../../activities/execute-deep-agent/translator.js";
import type { V3ProtocolEvent } from "../../activities/execute-deep-agent/v3-event-recorder.js";
import { buildChatModel } from "../model-client.js";
import { classifyModelCallError } from "../model-error.js";
import { _resetRegistryCache } from "../model-registry.js";
import { resetRunnerSecretsForTests, setRunnerSecret } from "../runner-credential-store.js";

/** A current Gemini model on Google's free tier. */
const LIVE_MODEL = "google:gemini-4-hydrogen";

describe.skipIf(!liveSecret("GEMINI_API_KEY"))("the Google client live, on Gemini", () => {
  let registry: ReturnType<typeof stubRegistryFetch>;
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = useProviderDirectly();
    _resetRegistryCache();
    registry = stubRegistryFetch({ live: true });
  });

  afterAll(() => {
    registry.restore();
    resetRunnerSecretsForTests();
    restoreEnv();
  });

  it("signs a tool call, and accepts it back after a streamed step and an approval pause; the usage counts the thinking", async () => {
    let ran = 0;
    const lookup = tool(
      async ({ city }: { city: string }) => {
        ran += 1;
        return `${city}: 21 degrees, clear`;
      },
      { name: "lookup_weather", description: "Look up the current weather in a city.", schema: z.object({ city: z.string() }) },
    );
    const { model } = await buildChatModel({ modelName: LIVE_MODEL, temperature: null, streaming: true });
    const agent = createAgent({
      model,
      tools: [lookup],
      middleware: [humanInTheLoopMiddleware({ interruptOn: { lookup_weather: true } })],
      checkpointer: new MemorySaver(),
    });
    const config = { configurable: { thread_id: "live-google-approval" } };
    const finishes: V3UsagePayload[] = [];
    const stream = async (input: unknown): Promise<{ messages: BaseMessage[] }> => {
      const run = (await agent.streamEvents(input as never, { ...config, version: "v3" })) as AsyncIterable<unknown> & { output: Promise<{ messages: BaseMessage[] }> };
      for await (const event of run) {
        const usage = usageOf(event as V3ProtocolEvent);
        if (usage !== undefined) finishes.push(usage);
      }
      return run.output;
    };

    await stream({ messages: [new HumanMessage("Use the lookup_weather tool for Paris, then tell me the weather in one sentence.")] });
    expect(ran, "the turn paused before the tool ran").toBe(0);
    const done = await stream(new Command({ resume: { decisions: [{ type: "approve" }] } }));

    expect(ran).toBe(1);
    expect(done.messages.at(-1)?.text).toMatch(/21/);
    expect(finishes.length).toBeGreaterThanOrEqual(2);
    for (const usage of finishes) {
      expect(usage.input_tokens).toBeGreaterThan(0);
      expect(usage.output_tokens).toBeGreaterThan(0);
      expect(usage.output_tokens, "the thinking is counted as output").toBe((usage.total_tokens ?? 0) - (usage.input_tokens ?? 0));
    }
  });

  it("answers a forced function call with thinking on", async () => {
    const { model } = await buildChatModel({
      modelName: LIVE_MODEL,
      temperature: null,
      thinking: { mode: ThinkingMode.ENABLED, profile: { shape: "adaptive", required: undefined } },
    });
    const verdict = model.withStructuredOutput(z.object({ approved: z.boolean() }), { method: "functionCalling", name: "verdict" });

    expect(await verdict.invoke("Is 2 + 2 equal to 4? Answer with the verdict tool.")).toEqual({ approved: true });
  });

  it("refuses a wrong key with API_KEY_INVALID, which reads as the key's fault", async () => {
    setRunnerSecret("GEMINI_API_KEY", "AIza-not-a-real-key");
    try {
      const { model } = await buildChatModel({ modelName: LIVE_MODEL });
      const failure = await model.invoke("Hello").then(() => undefined, (err: unknown) => err);

      expect((failure as { statusCode?: unknown } | undefined)?.statusCode).toBe(400);
      expect(classifyModelCallError(failure, { proxyMode: false, provider: "google", modelId: "gemini-4-hydrogen" })?.code).toBe("LLM_AUTHENTICATION_ERROR");
    } finally {
      resetRunnerSecretsForTests();
    }
  });
});
