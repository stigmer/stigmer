/*
 * Spike probe: does every model call the engine makes go through
 * Stigmer's agent proxy, and nowhere else?
 *
 * The real `AgentProxy` runs in forward mode with the mock as the platform's
 * endpoint and one turn opened with a minted key. The engine is a separate
 * program, so it carries the proxy's address in ANTHROPIC_BASE_URL, the host
 * token in ANTHROPIC_API_KEY, and the turn key and execution id in
 * ANTHROPIC_CUSTOM_HEADERS. Pass: every request the mock captured came
 * through the proxy's Anthropic lane carrying the turn's execution id and the
 * runner's credential, never the host's or the turn's.
 *
 * Also recorded: what the engine does when its turn is closed under it, and
 * the turn-credential arm (the lane admits the turn's key in place of
 * the host token, so the engine never holds the host token).
 *
 * The "no other egress" half runs in the container (`container/q4-q5.sh`),
 * where `strace` lists every socket the engine opens.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentProxy } from "../../agent-proxy/server.js";
import { hermeticCursorConfig } from "../../activities/execute-cursor/__test-utils__/hermetic-cursor.js";
import type { HermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import type { Config } from "../../config.js";
import {
  anthropicText,
  baseOptions,
  freshDirs,
  recordingCanUseTool,
  resultSummary,
  runQuery,
  spikeEnv,
  startSpikeMock,
  toolId,
  writeEvidence,
  type SpikeDirs,
} from "./harness.js";
import { delegate, oneCall, scenarios } from "./scripts.js";

const TIMEOUT = 240_000;
const EXECUTION_ID = "aex_spike_q4_0001";
const RUNNER_TOKEN = "runner-token-spike-q4";

function proxyConfig(platform: string): Config {
  const root = mkdtempSync(join(tmpdir(), "claude-spike-q4-"));
  return {
    ...hermeticCursorConfig({ workspaceRootDir: root } as HermeticEnvironment),
    mode: "local",
    proxyEndpoint: platform,
    stigmerTokenRef: { current: RUNNER_TOKEN },
  };
}

/** The engine's environment as the agent host would build it for one turn. */
export function engineEnvThroughProxy(dirs: SpikeDirs, proxyEndpoint: string, apiKey: string, turnKey: string): Record<string, string> {
  return spikeEnv({
    mockUrl: `${proxyEndpoint}/v1/proxy/llm/anthropic`,
    dirs,
    apiKey,
    extra: { ANTHROPIC_CUSTOM_HEADERS: `X-Stigmer-Turn-Key: ${turnKey}\nX-Stigmer-Execution-Id: ${EXECUTION_ID}` },
  });
}

const BASH = toolId("q4_bash");
const AGENT = toolId("q4_agent");
const script = scenarios([
  { marker: "Q4-TEXT", answer: () => anthropicText("q4 text") },
  oneCall("Q4-TOOL", { toolCallId: BASH, toolName: "Bash", toolInput: { command: "echo through-proxy", description: "print" } }, "q4 tool done"),
  delegate("Q4-SUB-PARENT", AGENT, "Q4-SUB-CHILD answer", "q4 parent done"),
  { marker: "Q4-SUB-CHILD", answer: () => anthropicText("q4 child") },
  { marker: "Q4-CLOSED", answer: () => anthropicText("q4 closed turn should never be answered") },
  { marker: "Q4-TURNCRED", answer: () => anthropicText("q4 turn credential answered") },
]);

describe("q4: every model call through the agent proxy's Anthropic lane", () => {
  it("routes a text turn, a tool turn and a sub-agent turn through the lane with the turn's execution id", async () => {
    const mock = await startSpikeMock("q4", script);
    const proxy = await AgentProxy.start(proxyConfig(mock.url));
    const hostToken = randomBytes(24).toString("hex");
    const turnKey = randomBytes(24).toString("hex");
    proxy.authorizeHost(hostToken);
    const closeTurn = proxy.openTurn({ executionId: EXECUTION_ID, threadId: "thread-q4", turnKey });
    try {
      const runs: Record<string, unknown> = {};
      for (const [label, prompt] of [
        ["text", "Q4-TEXT hello"],
        ["tool", "Q4-TOOL run it"],
        ["subagent", "Q4-SUB-PARENT delegate"],
      ] as const) {
        const dirs = freshDirs(`q4-${label}`);
        const run = await runQuery(`q4-${label}`, prompt, {
          ...baseOptions(dirs, mock.url),
          env: engineEnvThroughProxy(dirs, proxy.endpoint, hostToken, turnKey),
          canUseTool: recordingCanUseTool(`q4-${label}`, [], () => ({ allow: true })),
        });
        runs[label] = resultSummary(run);
      }
      const captured = mock.requests().map((r) => ({
        path: r.path,
        disposition: r.disposition,
        executionId: r.headers?.["x-stigmer-execution-id"],
        authorization: typeof r.headers?.authorization === "string" ? r.headers.authorization.replace(RUNNER_TOKEN, "<runner-token>") : r.headers?.authorization,
        carriesHostToken: JSON.stringify(r.headers ?? {}).includes(hostToken),
        carriesTurnKey: JSON.stringify(r.headers ?? {}).includes(turnKey),
      }));
      const offLane = captured.filter((c) => !c.path.startsWith("/v1/proxy/llm/anthropic/") || c.executionId !== EXECUTION_ID || c.authorization !== "Bearer <runner-token>" || c.carriesHostToken || c.carriesTurnKey);
      writeEvidence("q4.facts.json", { runs, captured, offLane });
      expect.soft(captured.length).toBeGreaterThan(0);
      expect.soft(offLane, "every call came through the Anthropic lane with the turn's execution id and the runner's credential").toEqual([]);
    } finally {
      closeTurn();
      await proxy.close();
      await mock.close();
    }
  }, TIMEOUT);

  it("records what the engine does when its turn is closed under it", async () => {
    const mock = await startSpikeMock("q4-closed", script);
    const proxy = await AgentProxy.start(proxyConfig(mock.url));
    const hostToken = randomBytes(24).toString("hex");
    const turnKey = randomBytes(24).toString("hex");
    proxy.authorizeHost(hostToken);
    proxy.openTurn({ executionId: EXECUTION_ID, threadId: "thread-q4", turnKey })();
    try {
      const dirs = freshDirs("q4-closed");
      const run = await runQuery("q4-closed", "Q4-CLOSED hello", {
        ...baseOptions(dirs, mock.url),
        env: engineEnvThroughProxy(dirs, proxy.endpoint, hostToken, turnKey),
      });
      const retries = run.messages.filter((m) => m.type === "system" && (m as { subtype?: string }).subtype === "api_retry");
      writeEvidence("q4-closed.facts.json", { result: resultSummary(run), apiRetries: retries, mockSaw: mock.requests().length, wallMs: run.wallMs });
      expect.soft(mock.requests().length, "a closed turn's call never reaches the platform").toBe(0);
    } finally {
      await proxy.close();
      await mock.close();
    }
  }, TIMEOUT);

  it("turn credential: the engine holds only its turn's key, and the lane admits it", async () => {
    const mock = await startSpikeMock("q4-turncred", script);
    const proxy = await AgentProxy.start(proxyConfig(mock.url));
    const hostToken = randomBytes(24).toString("hex");
    const turnKey = randomBytes(24).toString("hex");
    proxy.authorizeHost(hostToken);
    const closeTurn = proxy.openTurn({ executionId: EXECUTION_ID, threadId: "thread-q4", turnKey });
    try {
      const facts: Record<string, unknown> = {};
      for (const on of [false, true]) {
        AgentProxy.spikeTurnCredential = on;
        const dirs = freshDirs(`q4-turncred-${on ? "on" : "off"}`);
        const run = await runQuery(`q4-turncred-${on ? "on" : "off"}`, "Q4-TURNCRED hello", {
          ...baseOptions(dirs, mock.url),
          env: engineEnvThroughProxy(dirs, proxy.endpoint, turnKey, turnKey),
        });
        facts[on ? "switchOn" : "switchOff"] = resultSummary(run);
      }
      facts.captured = mock.requests().map((r) => ({ path: r.path, executionId: r.headers?.["x-stigmer-execution-id"], carriesTurnKey: JSON.stringify(r.headers ?? {}).includes(turnKey) }));
      writeEvidence("q4-turncred.facts.json", facts);
      expect.soft((facts.switchOn as { result?: string }).result).toBe("q4 turn credential answered");
    } finally {
      AgentProxy.spikeTurnCredential = false;
      closeTurn();
      await proxy.close();
      await mock.close();
    }
  }, TIMEOUT);
});
