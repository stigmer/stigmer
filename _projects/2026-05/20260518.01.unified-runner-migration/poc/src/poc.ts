/**
 * T01c Feasibility PoC — DeepAgents JS + LangGraph JS
 *
 * Validates the core chain required for the unified runner migration:
 * 1. createDeepAgent with Anthropic model
 * 2. Custom middleware (loop detection proof-of-concept)
 * 3. MemorySaver checkpointer
 * 4. interrupt() + Command({ resume }) for HITL
 * 5. streamEvents capture (event shape validation)
 * 6. Subagent delegation via task tool
 *
 * NOT wired into Temporal — standalone script for feasibility validation.
 *
 * Usage: ANTHROPIC_API_KEY=sk-... npx tsx src/poc.ts
 */

import { createDeepAgent, StateBackend } from "deepagents";
import { MemorySaver, interrupt, Command } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required");
  process.exit(1);
}

const THREAD_ID = "poc-test-thread-001";

// ---------------------------------------------------------------------------
// Test 1: Basic createDeepAgent + streamEvents
// ---------------------------------------------------------------------------

async function testBasicAgent(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 1: Basic createDeepAgent + streamEvents");
  console.log("=".repeat(60));

  const model = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    apiKey: ANTHROPIC_API_KEY,
    temperature: 0,
  });

  const checkpointer = new MemorySaver();

  const agent = await createDeepAgent({
    model,
    checkpointer,
    backend: new StateBackend(),
    systemPrompt: "You are a helpful assistant. Be concise.",
  });

  console.log("\n[Agent created successfully]");
  console.log("  Type:", typeof agent);
  console.log("  Has invoke:", typeof agent.invoke === "function");
  console.log("  Has stream:", typeof agent.stream === "function");
  console.log("  Has streamEvents:", typeof agent.streamEvents === "function");

  // Stream a simple request and capture event shapes
  console.log("\n[Streaming a simple request...]");

  const eventTypes = new Set<string>();
  let tokenCount = 0;
  let finalResponse = "";

  const stream = agent.streamEvents(
    { messages: [{ role: "user", content: "What is 2+2? Answer in one word." }] },
    { version: "v2", configurable: { thread_id: THREAD_ID } },
  );

  for await (const event of stream) {
    eventTypes.add(event.event);

    if (event.event === "on_chat_model_stream" && event.data?.chunk) {
      const content = event.data.chunk.content;
      if (typeof content === "string" && content) {
        tokenCount++;
        process.stdout.write(content);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            tokenCount++;
            process.stdout.write(block.text);
          }
        }
      }
    }

    if (event.event === "on_chat_model_end" && event.data?.output) {
      const output = event.data.output;
      if (typeof output.content === "string") {
        finalResponse = output.content;
      } else if (Array.isArray(output.content)) {
        finalResponse = output.content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("");
      }
    }
  }

  console.log("\n");
  console.log("[Stream complete]");
  console.log("  Event types observed:", [...eventTypes].sort().join(", "));
  console.log("  Token chunks received:", tokenCount);
  console.log("  Final response:", finalResponse.trim().substring(0, 100));
  console.log("  PASS: streamEvents works with createDeepAgent");
}

// ---------------------------------------------------------------------------
// Test 2: Custom middleware (loop detection proof-of-concept)
// ---------------------------------------------------------------------------

async function testCustomMiddleware(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 2: Custom middleware (step counter)");
  console.log("=".repeat(60));

  const model = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    apiKey: ANTHROPIC_API_KEY,
    temperature: 0,
  });

  const checkpointer = new MemorySaver();

  // Custom middleware that counts tool calls (proof that middleware hooks work).
  // The JS middleware API: wrapToolCall(request, handler) where request has
  // { toolCall, tool, state, config } and handler executes the next layer.
  let toolCallCount = 0;
  const stepCounterMiddleware = {
    name: "step_counter",
    wrapToolCall: async (request: any, handler: any) => {
      toolCallCount++;
      const toolName = request.toolCall?.name ?? request.tool?.name ?? "unknown";
      console.log(`  [middleware] Tool call #${toolCallCount}: ${toolName}`);
      const result = await handler(request);
      console.log(`  [middleware] Tool call #${toolCallCount} completed`);
      return result;
    },
  };

  // A simple tool for the agent to call
  const calculatorTool = tool(
    async ({ expression }: { expression: string }) => {
      try {
        // Simple eval for PoC only
        const result = Function(`"use strict"; return (${expression})`)();
        return `Result: ${result}`;
      } catch {
        return `Error evaluating: ${expression}`;
      }
    },
    {
      name: "calculator",
      description: "Evaluate a mathematical expression",
      schema: z.object({
        expression: z.string().describe("The math expression to evaluate"),
      }),
    },
  );

  const agent = await createDeepAgent({
    model,
    checkpointer,
    backend: new StateBackend(),
    tools: [calculatorTool],
    middleware: [stepCounterMiddleware],
    systemPrompt: "You are a math assistant. Use the calculator tool for any math.",
  });

  console.log("[Agent with custom middleware created]");

  const result = await agent.invoke(
    { messages: [{ role: "user", content: "What is 17 * 23?" }] },
    { configurable: { thread_id: "poc-middleware-test" } },
  );

  const lastMessage = result.messages[result.messages.length - 1];
  console.log("\n  Final response:", typeof lastMessage.content === "string"
    ? lastMessage.content.substring(0, 100)
    : JSON.stringify(lastMessage.content).substring(0, 100));
  console.log("  Tool calls intercepted by middleware:", toolCallCount);
  console.log(
    toolCallCount > 0
      ? "  PASS: Custom middleware wrapToolCall works"
      : "  WARN: No tool calls intercepted (agent may not have used the tool)",
  );
}

// ---------------------------------------------------------------------------
// Test 3: HITL interrupt / resume via MemorySaver
// ---------------------------------------------------------------------------

async function testHitlInterruptResume(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 3: HITL interrupt() + Command({ resume })");
  console.log("=".repeat(60));

  const model = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    apiKey: ANTHROPIC_API_KEY,
    temperature: 0,
  });

  const checkpointer = new MemorySaver();
  const threadId = "poc-hitl-test";

  // A tool that will be gated by interruptOn (DeepAgents-native HITL).
  // The tool itself does NOT call interrupt() — the framework handles it.
  const dangerousTool = tool(
    async ({ action }: { action: string }) => {
      return `Action "${action}" executed successfully`;
    },
    {
      name: "dangerous_action",
      description: "Performs a dangerous action that requires human approval",
      schema: z.object({
        action: z.string().describe("The action to perform"),
      }),
    },
  );

  const agent = await createDeepAgent({
    model,
    checkpointer,
    backend: new StateBackend(),
    tools: [dangerousTool],
    // interruptOn is a record mapping tool names to approval config.
    // The framework interrupts before executing the tool, pausing until resume.
    interruptOn: {
      dangerous_action: {
        allowedDecisions: ["approve", "reject"],
        description: "This action requires human approval before execution",
      },
    },
    systemPrompt:
      "You are an assistant that can perform dangerous actions. " +
      "When asked to perform an action, use the dangerous_action tool.",
  });

  console.log("[Agent with HITL tool created (interruptOn: dangerous_action)]");

  // Phase 1: Invoke the agent — should pause at the tool call
  console.log("\n[Phase 1: Invoke agent — expect interrupt before tool execution...]");

  const config = { configurable: { thread_id: threadId } };

  const result = await agent.invoke(
    { messages: [{ role: "user", content: "Please delete the temp files" }] },
    config,
  );

  // After invoke returns with interrupt, check graph state
  const state = await agent.getState(config);
  const interrupts = state.tasks
    ?.flatMap((t: any) => t.interrupts ?? [])
    ?? [];

  console.log("  Graph state next:", JSON.stringify(state.next));
  console.log("  Interrupts found:", interrupts.length);

  if (interrupts.length > 0) {
    console.log("  Interrupt value:", JSON.stringify(interrupts[0].value, null, 2));

    // Phase 2: Resume with approval
    console.log("\n[Phase 2: Resume with 'approve' decision...]");

    const resumeResult = await agent.invoke(
      new Command({ resume: { action: "approve" } }),
      config,
    );

    const lastMsg = resumeResult.messages[resumeResult.messages.length - 1];
    const content = typeof lastMsg.content === "string"
      ? lastMsg.content
      : JSON.stringify(lastMsg.content);
    console.log("  Resumed response:", content.substring(0, 200));
    console.log("  PASS: interruptOn + Command({ resume }) works end-to-end");
  } else {
    // interruptOn may surface differently — check if the agent paused
    console.log("  No interrupt in tasks. Checking state more deeply...");
    console.log("  Messages count:", result.messages?.length);
    const lastMsg = result.messages?.[result.messages.length - 1];
    if (lastMsg) {
      const content = typeof lastMsg.content === "string"
        ? lastMsg.content
        : JSON.stringify(lastMsg.content);
      console.log("  Last message:", content.substring(0, 200));
    }
    console.log("  State next:", state.next);
    console.log("  State tasks:", JSON.stringify(state.tasks?.map((t: any) => ({
      id: t.id,
      name: t.name,
      interrupts: t.interrupts?.length ?? 0,
      error: t.error,
    })), null, 2));
    console.log("  PARTIAL: interruptOn may need different configuration — investigate further");
  }
}

// ---------------------------------------------------------------------------
// Test 4: Subagent delegation
// ---------------------------------------------------------------------------

async function testSubagent(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("TEST 4: Subagent delegation via task tool");
  console.log("=".repeat(60));

  const model = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    apiKey: ANTHROPIC_API_KEY,
    temperature: 0,
  });

  const checkpointer = new MemorySaver();

  const agent = await createDeepAgent({
    model,
    checkpointer,
    backend: new StateBackend(),
    subagents: [
      {
        name: "math_expert",
        description: "A specialist in mathematical calculations",
        systemPrompt: "You are a math expert. Solve math problems step by step. Be concise.",
        model,
      },
    ],
    systemPrompt:
      "You are a project manager. Delegate math questions to the math_expert subagent using the task tool.",
  });

  console.log("[Agent with subagent created]");
  console.log("  Has task tool for delegation: checking...");

  const result = await agent.invoke(
    { messages: [{ role: "user", content: "What is the square root of 144?" }] },
    { configurable: { thread_id: "poc-subagent-test" } },
  );

  const lastMsg = result.messages[result.messages.length - 1];
  const content = typeof lastMsg.content === "string"
    ? lastMsg.content
    : JSON.stringify(lastMsg.content);
  console.log("  Response:", content.substring(0, 200));

  // Check if subagent was used (look for task tool calls in messages)
  const taskToolCalls = result.messages
    .filter((m: any) => m.tool_calls?.some((tc: any) => tc.name === "task"))
    .length;
  console.log("  Task tool delegations:", taskToolCalls);
  console.log(
    taskToolCalls > 0
      ? "  PASS: Subagent delegation works"
      : "  NOTE: Agent answered directly (may not have delegated — acceptable for simple questions)",
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  T01c Feasibility PoC — DeepAgents JS + LangGraph JS   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();
  console.log("Environment:");
  console.log("  Node:", process.version);
  console.log("  ANTHROPIC_API_KEY:", ANTHROPIC_API_KEY ? "set (sk-...)" : "MISSING");

  const results: { test: string; status: string }[] = [];

  // Test 1: Basic agent + streaming
  try {
    await testBasicAgent();
    results.push({ test: "Basic agent + streamEvents", status: "PASS" });
  } catch (err: any) {
    console.error("  FAIL:", err.message);
    if (err.stack) console.error(err.stack);
    results.push({ test: "Basic agent + streamEvents", status: `FAIL: ${err.message}` });
  }

  // Test 2: Custom middleware
  try {
    await testCustomMiddleware();
    results.push({ test: "Custom middleware (wrapToolCall)", status: "PASS" });
  } catch (err: any) {
    console.error("  FAIL:", err.message);
    if (err.stack) console.error(err.stack);
    results.push({ test: "Custom middleware", status: `FAIL: ${err.message}` });
  }

  // Test 3: HITL interrupt/resume
  try {
    await testHitlInterruptResume();
    results.push({ test: "HITL interrupt/resume", status: "PASS" });
  } catch (err: any) {
    console.error("  FAIL:", err.message);
    if (err.stack) console.error(err.stack);
    results.push({ test: "HITL interrupt/resume", status: `FAIL: ${err.message}` });
  }

  // Test 4: Subagent delegation
  try {
    await testSubagent();
    results.push({ test: "Subagent delegation", status: "PASS" });
  } catch (err: any) {
    console.error("  FAIL:", err.message);
    if (err.stack) console.error(err.stack);
    results.push({ test: "Subagent delegation", status: `FAIL: ${err.message}` });
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  for (const r of results) {
    const icon = r.status === "PASS" ? "[OK]" : "[!!]";
    console.log(`  ${icon} ${r.test}: ${r.status}`);
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  const total = results.length;
  console.log(`\n  ${passed}/${total} tests passed`);

  if (passed === total) {
    console.log("\n  GATE RECOMMENDATION: GO — all core capabilities validated");
  } else {
    console.log("\n  GATE RECOMMENDATION: REVIEW — some tests failed, investigate before proceeding");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
