/**
 * The wire contract of structured output on a Stigmer graph: what each
 * provider's model receives when a message carries
 * `spec.structured_output_schema`, recorded as a file snapshot.
 *
 * The response format is the runner's own (`structured-output-format.ts`),
 * handed to langchain's `createAgent`, the agent loop `createDeepAgent` runs
 * on, so langchain's strategy choice and its provider conversion are both
 * inside the recording. The model is a real `ChatAnthropic` or `ChatOpenAI`
 * whose transport keeps the first request and refuses it
 * (`__test-utils__/captured-llm-request.ts`): no network, the provider SDK's
 * own body. Deepagents' own tools are left out on purpose; they are theirs.
 *
 * The fixture is `ANSWER_FORM` (`__test-utils__/answer-form-fixture.ts`).
 *
 * Regenerate ONLY after a deliberate change to what structured output sends:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/structured-output-wire.test.ts -u
 */

import { describe, expect, it } from "vitest";
import { createAgent } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { structuredOutputFormat } from "../structured-output-format.js";
import {
  capturingAnthropic,
  capturingOpenAI,
  wireSchemaPart,
  type CapturedBodies,
} from "../../../__test-utils__/captured-llm-request.js";
import { ANSWER_FORM } from "../../../__test-utils__/answer-form-fixture.js";

async function firstRequest(model: BaseChatModel, graphThinks: boolean): Promise<Record<string, unknown>> {
  const sink = (model as unknown as { __sink: CapturedBodies }).__sink;
  const agent = createAgent({
    model,
    tools: [],
    responseFormat: structuredOutputFormat(ANSWER_FORM, graphThinks) as never,
  });
  await expect(agent.invoke({ messages: [{ role: "user", content: "Review the candidate." }] })).rejects.toThrow();
  expect(sink, "exactly one request reached the transport").toHaveLength(1);
  return wireSchemaPart(sink[0]!);
}

function withSink<M extends BaseChatModel>(build: (sink: CapturedBodies) => M): M {
  const sink: CapturedBodies = [];
  const model = build(sink);
  Object.defineProperty(model, "__sink", { value: sink });
  return model;
}

describe("structured output on the wire", () => {
  it("each provider receives the recorded answer form", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const cases: Array<[string, BaseChatModel, boolean]> = [
      ["anthropic, not thinking", withSink((s) => capturingAnthropic(s, "claude-sonnet-4-5")), false],
      ["anthropic, thinking", withSink((s) => capturingAnthropic(s, "claude-sonnet-4-5", { type: "enabled", budget_tokens: 1024 })), true],
      ["openai, not thinking", withSink((s) => capturingOpenAI(s, "gpt-4.1")), false],
      ["gemini on an openai-compatible endpoint, not thinking", withSink((s) => capturingOpenAI(s, "gemini-2.5-flash", "https://gemini.example.invalid/v1")), false],
    ];

    // ── Act ──────────────────────────────────────────────────────────────────
    const recorded: Record<string, unknown> = {};
    for (const [label, model, thinks] of cases) recorded[label] = await firstRequest(model, thinks);

    // ── Assert ───────────────────────────────────────────────────────────────
    await expect(JSON.stringify(recorded, null, 2) + "\n").toMatchFileSnapshot("./goldens/structured-output-wire.json");
  });
});
