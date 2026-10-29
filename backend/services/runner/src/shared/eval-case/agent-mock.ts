/**
 * A eval-case `agent` mock: a model playing the plugin's MCP server for
 * one try, from the instructions the mock file's body gives, as Claude
 * Code's judge model plays it.
 *
 * Each call is one model request: the instructions as the system prompt,
 * that server's earlier calls and answers as the conversation (so a
 * tracker that "created issue #12" remembers it), and this call last. The
 * model is the eval's judge model, or the runner's default when the eval
 * names none, the reading an empty model has everywhere on the runner. It
 * goes through the proxy with the try's execution scope, so the proxy bills
 * the try, and its cost is priced as the native engine prices its own
 * (`computeTurnCost` on the model's pricing) for the try's estimate and
 * cap.
 *
 * `abort_when` lists the only conditions under which the server may end the
 * test. The model ends it by answering with a first line `ABORT: <reason>`;
 * nothing else it says ends a run.
 */

import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { Config } from "../../config.js";
import { buildChatModel } from "../model-client.js";
import { computeTurnCost, ensureLoaded as ensurePricingLoaded, getModelPricing } from "../model-pricing.js";
import { getDefaultModel } from "../model-registry.js";

/** One earlier call to the same server, as the model sees it. */
export interface AgentMockExchange {
  readonly tool: string;
  readonly input: unknown;
  readonly answer: string;
}

/** What an agent mock is asked. */
export interface AgentMockRequest {
  /** The server's key in the plugin's MCP configuration. */
  readonly server: string;
  readonly tool: string;
  /** The mock file's body. */
  readonly instructions: string;
  /** The mock's `abort_when`, or "" when it may never end the run. */
  readonly abortWhen: string;
  readonly input: unknown;
  readonly history: readonly AgentMockExchange[];
}

/** What it answered, and what the answer cost in estimated US dollars. */
export type AgentMockAnswer =
  | { readonly kind: "answer"; readonly text: string; readonly costUsd: number }
  | { readonly kind: "abort"; readonly reason: string; readonly costUsd: number };

/** The model behind every agent mock of one try. */
export type AgentMockModel = (request: AgentMockRequest) => Promise<AgentMockAnswer>;

/** The most tokens one agent-mock answer may run to. */
const MAX_ANSWER_TOKENS = 4096;

/** The agent-mock model for a try: `modelName` or the runner's default, through the try's proxy scope. */
export function chatAgentMockModel(args: {
  readonly modelName: string;
  readonly config: Config;
  readonly executionId: string;
}): AgentMockModel {
  return async (request) => {
    const modelName = args.modelName !== "" ? args.modelName : await getDefaultModel("stigmer");
    const { model } = await buildChatModel({
      modelName,
      proxyEndpoint: args.config.proxyEndpoint ?? undefined,
      stigmerToken: args.config.stigmerTokenRef.current ?? undefined,
      headerScope: { executionId: args.executionId },
      temperature: null,
      maxTokens: MAX_ANSWER_TOKENS,
    });
    const result = await model.invoke(agentMockMessages(request));
    await ensurePricingLoaded();
    const usage = result.usage_metadata;
    const cacheRead = usage?.input_token_details?.cache_read ?? 0;
    const cacheWrite = usage?.input_token_details?.cache_creation ?? 0;
    const inputTokens = usage?.input_tokens ?? 0;
    const costUsd = computeTurnCost(
      getModelPricing(modelName),
      Math.max(inputTokens - cacheRead - cacheWrite, 0),
      usage?.output_tokens ?? 0,
      cacheWrite,
      cacheRead,
    );
    return readAnswer(textOf(result.content), request.abortWhen !== "", costUsd);
  };
}

/** The request as messages (the module header). Exported for tests. */
export function agentMockMessages(request: AgentMockRequest): BaseMessage[] {
  const system = [
    `You are standing in for the MCP server '${request.server}' while a plugin is tested.`,
    "Answer each tool call exactly as that server would, following these instructions, and reply with the tool's result only.",
    "",
    request.instructions,
    ...(request.abortWhen === ""
      ? []
      : [
          "",
          `You may end the test only when one of these conditions holds: ${request.abortWhen}`,
          "To end it, reply with a single first line `ABORT: <the reason>` and nothing else.",
        ]),
  ].join("\n");
  const call = (tool: string, input: unknown): string => `Tool: ${tool}\nInput: ${JSON.stringify(input ?? {})}`;
  return [
    new SystemMessage(system),
    ...request.history.flatMap((exchange) => [new HumanMessage(call(exchange.tool, exchange.input)), new AIMessage(exchange.answer)]),
    new HumanMessage(call(request.tool, request.input)),
  ];
}

/** The model's reply as an answer, or an abort when it may abort and did. Exported for tests. */
export function readAnswer(text: string, mayAbort: boolean, costUsd: number): AgentMockAnswer {
  const abort = /^\s*ABORT:\s*(.*)$/m.exec(text.split("\n")[0] ?? "");
  if (mayAbort && abort !== null) return { kind: "abort", reason: (abort[1] ?? "").trim() || "the mock ended the run", costUsd };
  return { kind: "answer", text, costUsd };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) =>
      typeof part === "object" && part !== null && "text" in part && typeof (part as { text: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .join("");
}
