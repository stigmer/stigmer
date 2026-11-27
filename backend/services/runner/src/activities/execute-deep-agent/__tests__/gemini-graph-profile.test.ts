/**
 * A Gemini graph gets the Stigmer harness profile (`deepagents-profiles.ts`),
 * as a Claude or GPT graph does: no `general-purpose` sub-agent of
 * deepagents' own, and no `delete` tool.
 *
 * deepagents places a graph's profile by its model's class, from a table
 * that does not hold LangChain's current Google client (`ChatGoogle`), and
 * otherwise by the model's `provider:model` name, which the runner's Google
 * model states (`shared/model-client.ts`). Without a profile deepagents
 * injects its own `general-purpose` sub-agent, whose tool calls never pass
 * the parent's middleware (the approval gate among them): measured on
 * deepagents 1.14.1, a gated tool ran inside it with the parent's
 * middleware seeing only `task`. The graph here is deepagents' own, on the
 * runner-built model against the conformance mock's Gemini wire, so the
 * case fails the day either half stops holding.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { createDeepAgent } from "deepagents";
import { createMiddleware, tool } from "langchain";
import { z } from "zod";
import { anthropicText, anthropicToolUse, MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { readGeminiRequest } from "@stigmer/test-support/llm-wire";

import { buildChatModel } from "../../../shared/model-client.js";
import { _resetRegistryCache } from "../../../shared/model-registry.js";
import { stubRegistryFetch } from "../../../__test-utils__/model-registry-fixture.js";
import { registerStigmerDeepagentsProfiles } from "../deepagents-profiles.js";

let mock: MockLlmProxy;
let registry: ReturnType<typeof stubRegistryFetch>;

beforeAll(async () => {
  registerStigmerDeepagentsProfiles();
  mock = new MockLlmProxy();
  await mock.start();
  _resetRegistryCache();
  registry = stubRegistryFetch({ live: true });
});

afterEach(() => mock.reset());

afterAll(async () => {
  registry.restore();
  await mock.close();
});

async function geminiGraph(tools: Parameters<typeof createDeepAgent>[0] extends infer P ? P extends { tools?: infer T } ? T : never : never, seen: string[]) {
  const { model } = await buildChatModel({ modelName: "google:gemini-3-flash", proxyEndpoint: mock.url(), stigmerToken: "t", temperature: null });
  // Stands in for the approval gate: a middleware of the parent's, which
  // sees every tool call that passes the parent's stack.
  const gate = createMiddleware({
    name: "GateStandIn",
    wrapToolCall: async (request, handler) => {
      seen.push(request.toolCall.name);
      return handler(request);
    },
  });
  return createDeepAgent({ model, tools, middleware: [gate] } as Parameters<typeof createDeepAgent>[0]);
}

describe("a Gemini graph and the Stigmer harness profile", () => {
  it("offers no delete tool and names no sub-agent", async () => {
    mock.enqueue(anthropicText("Hello."));

    await (await geminiGraph([], [])).invoke({ messages: [new HumanMessage("Hello")] });

    const declarations = readGeminiRequest(mock.scriptedRequests()[0]?.body).tools?.flatMap((entry) => entry.functionDeclarations ?? []) ?? [];
    expect(declarations.map((declaration) => declaration.name)).not.toContain("delete");
    const task = declarations.find((declaration) => declaration.name === "task");
    expect(JSON.stringify(task?.parameters)).toContain('"Name of the agent to use. Available: "');
  });

  it("never runs a tool inside deepagents' own general-purpose sub-agent", async () => {
    let ran = 0;
    const gated = tool(
      async () => {
        ran += 1;
        return "ran";
      },
      { name: "gated_action", description: "An action that needs approval.", schema: z.object({}) },
    );
    mock
      .enqueue(anthropicToolUse("call_task", "task", { description: "Do the action.", subagent_type: "general-purpose" }))
      .enqueue(anthropicToolUse("call_gated", "gated_action", {}))
      .enqueue(anthropicText("Done."))
      .enqueue(anthropicText("Done."));
    const seen: string[] = [];

    await (await geminiGraph([gated], seen)).invoke({ messages: [new HumanMessage("Go")] }).catch(() => undefined);

    expect(ran, "the gated tool ran outside the parent's middleware").toBe(0);
    expect(seen).not.toContain("gated_action");
  });
});
