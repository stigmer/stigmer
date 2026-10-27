/**
 * The model the Claude engine talks to in a hermetic run: the conformance
 * suite's wire-level mock (`test/support/src/mock-llm.ts`), answering every
 * request from its conversation, behind the runner's real local proxy.
 *
 * There is no SDK double for this harness. The engine is the real program,
 * and a test scripts only what its model says: a {@link WireScript} reads the
 * conversation a request carries (the run's messages, the tool results, the
 * system prompt, the headers) and answers it. How a request is read, and
 * which of the engine's calls are background calls answered out of band
 * (token counts, its compaction summary), is the shared reading in
 * `test/support/src/claude-engine-wire.ts`, which the execution conformance
 * suite's Claude arms use too.
 *
 * The stack ({@link startClaudeWire}): the mock, and the production proxy
 * (`agent-proxy/server.ts`) in forward mode pointed at it, so every model
 * call the engine makes crosses the turn-credential rule, the Anthropic
 * lane's path rule and the forward relay exactly as in a cloud runner, and
 * arrives at the mock with the runner's credential and the run's execution
 * id. The proxy is handed to the hosted row (`__test-utils__/loopback-host.ts`).
 */

import { MockLlmProxy, type CapturedLlmRequest } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUses, type AnthropicMessageBody, type TokenUsageOptions } from "@stigmer/test-support/llm-wire";
import { claudeEngineRoute, type ClaudeEngineRouteOptions, type WireConversation, type WireScript } from "@stigmer/test-support/claude-engine-wire";

import type { Config } from "../../../config.js";
import { AgentProxy } from "../../../agent-proxy/server.js";

export { anthropicText, anthropicToolUses, type AnthropicMessageBody, type TokenUsageOptions };
export { readConversation, saidByUser, type WireConversation, type WireScript, type WireToolResult } from "@stigmer/test-support/claude-engine-wire";

/** The running stack: the mock, the proxy in front of it, and what each saw. */
export interface ClaudeWire {
  readonly mock: MockLlmProxy;
  readonly proxy: AgentProxy;
  /** Every agent-loop conversation the mock answered, in order. */
  readonly conversations: WireConversation[];
  /** Every request the mock received, its own capture. */
  requests(): readonly CapturedLlmRequest[];
  /** Replace the script for the requests that follow. */
  script(next: WireScript): void;
  close(): Promise<void>;
}

/** The token the proxy forwards with, standing for the runner's control-plane credential. */
export const WIRE_RUNNER_TOKEN = "hermetic-runner-token";

/** Start the mock and the proxy in front of it (the header), answering with `script`; `options` sees the engine's compactions. */
export async function startClaudeWire(config: Config, script: WireScript, options: Omit<ClaudeEngineRouteOptions, "onConversation"> = {}): Promise<ClaudeWire> {
  let current = script;
  const conversations: WireConversation[] = [];
  const engine = claudeEngineRoute((conversation) => current(conversation), {
    ...options,
    onConversation: (conversation) => conversations.push(conversation),
  });
  const mock = new MockLlmProxy({ route: engine.route });
  await mock.start();
  const proxy = await AgentProxy.start({ ...config, proxyEndpoint: mock.url(), stigmerTokenRef: { current: WIRE_RUNNER_TOKEN } });
  return {
    mock,
    proxy,
    conversations,
    requests: () => mock.requests(),
    script: (next) => {
      current = next;
    },
    close: async () => {
      await proxy.close();
      await mock.close();
    },
  };
}
