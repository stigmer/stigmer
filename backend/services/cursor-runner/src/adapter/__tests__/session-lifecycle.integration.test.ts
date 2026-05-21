/**
 * Integration test for the Cursor SDK Agent lifecycle.
 *
 * Exercises the full create → send → resume → send cycle using a real
 * Cursor API key. This proves whether the SDK-level follow-up (resume)
 * works at all, isolating Cursor from the Stigmer orchestration layer.
 *
 * Requires CURSOR_API_KEY in environment. Skipped when not available.
 *
 * Run: CURSOR_API_KEY=crsr_... npx vitest run src/adapter/__tests__/session-lifecycle.integration.test.ts
 */

import { describe, it, expect } from "vitest";
import { Agent } from "@cursor/sdk";
import type { SDKAgent } from "@cursor/sdk";
import { createAgent, resumeAgent, resolveAgent } from "../session-lifecycle.js";

const API_KEY = process.env.CURSOR_API_KEY;
const SKIP = !API_KEY;
const TIMEOUT = 120_000; // 2 minutes per test — Cursor agents can be slow
const TEST_SESSION_ID = "integration-test-session-001";

describe.skipIf(SKIP)("session-lifecycle integration (real Cursor API)", () => {
  let createdAgentId: string;

  it("creates an agent and sends a message", async () => {
    const agent: SDKAgent = await createAgent({
      apiKey: API_KEY!,
      model: "default",
      workspaceDirs: ["/tmp/stigmer-test-workspace"],
      sessionId: TEST_SESSION_ID,
    });

    expect(agent).toBeDefined();
    expect(agent.agentId).toBeTruthy();
    createdAgentId = agent.agentId;

    const run = await agent.send("What is 2 + 2? Reply with just the number.");
    const events: unknown[] = [];
    for await (const event of run.stream()) {
      events.push(event);
    }
    const result = await run.wait();

    expect(result.status).toBe("finished");
    expect(events.length).toBeGreaterThan(0);

    console.log(
      `[Test] Agent created: ${createdAgentId}, events: ${events.length}, status: ${result.status}`,
    );
  }, TIMEOUT);

  it("resume WITHOUT model fails (reproduces the production bug)", async () => {
    expect(createdAgentId).toBeTruthy();

    const resumed: SDKAgent = await resumeAgent({
      apiKey: API_KEY!,
      agentId: createdAgentId,
      sessionId: TEST_SESSION_ID,
    });

    // The SDK requires model on send() for local agents — this is the bug:
    // resumeAgent doesn't pass model, so send() throws.
    await expect(
      resumed.send("Now multiply that result by 3."),
    ).rejects.toThrow(/model/i);

    console.log(
      `[Test] Confirmed: resume without model throws ConfigurationError`,
    );
  }, TIMEOUT);

  it("resume WITH model on send() succeeds (the fix)", async () => {
    expect(createdAgentId).toBeTruthy();

    const resumed = await Agent.resume(createdAgentId, {
      apiKey: API_KEY!,
      model: { id: "default" },
    });

    expect(resumed).toBeDefined();
    expect(resumed.agentId).toBe(createdAgentId);

    const run = await resumed.send(
      "Now multiply that result by 3. Reply with just the number.",
    );
    const events: unknown[] = [];
    for await (const event of run.stream()) {
      events.push(event);
    }
    const result = await run.wait();

    expect(result.status).toBe("finished");
    expect(events.length).toBeGreaterThan(0);

    console.log(
      `[Test] Agent resumed WITH model: ${createdAgentId}, events: ${events.length}, status: ${result.status}`,
    );
  }, TIMEOUT);

  it("resolveAgent creates on empty harnessStateId (model passed via createOptions)", async () => {
    const { agent: newAgent, isNew } = await resolveAgent("", {
      apiKey: API_KEY!,
      model: "default",
      workspaceDirs: ["/tmp/stigmer-test-workspace"],
      sessionId: TEST_SESSION_ID,
    });

    expect(isNew).toBe(true);
    expect(newAgent.agentId).toBeTruthy();

    const run1 = await newAgent.send("Say 'hello' and nothing else.");
    for await (const _ of run1.stream()) { /* drain */ }
    const result1 = await run1.wait();
    expect(result1.status).toBe("finished");

    console.log(
      `[Test] resolveAgent create: agentId=${newAgent.agentId}, status=${result1.status}`,
    );
  }, TIMEOUT);

  it("resolveAgent resume with model succeeds (after fix)", async () => {
    expect(createdAgentId).toBeTruthy();

    // After the fix: resolveAgent passes model through to Agent.resume()
    const { agent: resumedAgent, isNew } = await resolveAgent(createdAgentId, {
      apiKey: API_KEY!,
      model: "default",
      workspaceDirs: ["/tmp/stigmer-test-workspace"],
      sessionId: TEST_SESSION_ID,
    });

    expect(isNew).toBe(false);

    const run = await resumedAgent.send("Say 'world' and nothing else.");
    for await (const _ of run.stream()) { /* drain */ }
    const result = await run.wait();
    expect(result.status).toBe("finished");

    console.log(
      `[Test] resolveAgent resume with model: agentId=${createdAgentId}, status=${result.status}`,
    );
  }, TIMEOUT);
});
