/**
 * Hermetic: a conversation without a computer (`SessionStatus.computer`
 * COMPUTER_NONE) through the whole `ExecuteDeepAgent` activity.
 *
 * Invariant pinned: the conversation's computer is every graph's. With
 * none, the parent graph and a saved subagent's graph are each offered no
 * `execute` tool, by the path plan mode takes (no shell environment, so a
 * filesystem-only backend and no subagent shell, `turn-setup.ts`). The same
 * agent and subagent in a conversation recorded before the setting (unset,
 * which has a computer) and in one that needs a computer are each offered
 * `execute`, so the test fails if the condition is removed.
 *
 * It reaches no machine of its own: on this local runner, whose posture
 * is relaxed, a `web_fetch` of a loopback server answers with the refusal
 * and an agent's own MCP server on this machine fails the turn with a
 * sentence naming it, before the model is asked; the same fetch with a
 * computer passes the guard.
 */

import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { BaseMessage } from "@langchain/core/messages";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { savedAgentFixture } from "../../../../__test-utils__/execution-record-fixture.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-deep-agent.js";

const WORKER = "You are the hermetic worker.";

describe("ExecuteDeepAgent hermetic — a conversation without a computer", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  /** Runs one turn that hands work to a saved subagent; answers the tools each graph was offered. */
  async function offered(computer: Computer | undefined): Promise<{ parent: string[]; worker: string[] }> {
    // A conversation without a computer lists only subagents without one.
    const worker = savedAgentFixture("worker", { description: "Works.", instructions: WORKER, ...(computer === Computer.NONE ? { computer } : {}) });
    const record = deepAgentExecutionRecord({
      message: "Delegate.",
      subagents: [worker],
      ...(computer === undefined ? {} : { computer }),
    });
    const seen = { parent: [] as string[], worker: [] as string[] };
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: (tools, context) => {
        if (context.systemPrompt.includes(WORKER)) {
          seen.worker = [...tools];
          return { turns: [{ text: "Worked." }] };
        }
        seen.parent = [...tools];
        return {
          turns: [
            { toolCalls: [{ id: "call-task", name: "task", args: { description: "Work.", subagent_type: "worker" } }] },
            { text: "Done." },
          ],
        };
      },
    });
    mkdirSync(sessionWorkspaceDir(env), { recursive: true });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    return seen;
  }

  it("offers neither the parent nor a subagent a shell", async () => {
    const seen = await offered(Computer.NONE);
    expect(seen.parent).toContain("read_file");
    expect(seen.parent).not.toContain("execute");
    expect(seen.worker).toContain("read_file");
    expect(seen.worker).not.toContain("execute");
  });

  it("keeps a note, returns an output and sets a result aside through the host, writing nothing to the runner's disk for the conversation", async () => {
    const record = deepAgentExecutionRecord({ message: "Work.", computer: Computer.NONE });
    let seen: readonly BaseMessage[] = [];
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => (transcript: readonly BaseMessage[]) => {
        seen = transcript;
        const rounds = transcript.filter((message) => message.getType() === "ai").length;
        if (rounds === 0) {
          return {
            toolCalls: [
              { id: "c-note", name: "write_file", args: { file_path: "/notes.md", content: "remember\n" } },
              { id: "c-out", name: "write_file", args: { file_path: "/.stigmer/outputs/reply.md", content: "Dear customer, v1\n" } },
              { id: "c-keep", name: "write_file", args: { file_path: "/large_tool_results/kept.txt", content: "kept result\n" } },
            ],
          };
        }
        if (rounds === 1) {
          return {
            toolCalls: [
              { id: "c-edit", name: "edit_file", args: { file_path: "/.stigmer/outputs/reply.md", old_string: "v1", new_string: "v2" } },
              { id: "c-back", name: "read_file", args: { file_path: "/large_tool_results/kept.txt" } },
              { id: "c-ls", name: "ls", args: { path: "/.stigmer/outputs" } },
              { id: "c-upload", name: "read_file", args: { file_path: "/.stigmer/uploads/none.txt" } },
            ],
          };
        }
        return { text: "Done." };
      },
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    const answer = (id: string) => {
      const message = seen.find((m) => (m as { tool_call_id?: string }).tool_call_id === id);
      return typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
    };
    expect(answer("c-back")).toContain("kept result");
    expect(answer("c-ls")).toContain("reply.md");
    expect(answer("c-upload")).toMatch(/no such file|not found/i);
    expect(record.registeredOutputs.map((output) => output.outputPath), "the edited output returns as one File").toEqual(["reply.md"]);
    const sessions = join(env.home, ".stigmer", "sessions");
    const made = existsSync(sessions) ? readdirSync(sessions).filter((session) => existsSync(join(sessions, session, "platform"))) : [];
    expect(made, "no platform folder is made for the conversation").toEqual([]);
  });

  describe("reach", () => {
    let page: Server;
    let pageUrl: string;

    beforeAll(async () => {
      page = createServer((_req, res) => res.end("the admin page"));
      await new Promise<void>((resolve) => page.listen(0, "127.0.0.1", resolve));
      pageUrl = `http://127.0.0.1:${(page.address() as AddressInfo).port}/admin`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => page.close(() => resolve()));
    });

    /** One turn that fetches the loopback page; answers what the fetch returned to the model. */
    async function fetched(computer: Computer): Promise<string> {
      const record = deepAgentExecutionRecord({ message: "Fetch the admin page.", computer });
      let seen: readonly BaseMessage[] = [];
      const scenario = beginDeepAgentScenario({
        env,
        clock,
        record,
        script: () => (transcript: readonly BaseMessage[]) => {
          seen = transcript;
          return transcript.some((message) => message.getType() === "ai")
            ? { text: "Done." }
            : { toolCalls: [{ id: "c-fetch", name: "web_fetch", args: { url: pageUrl } }] };
        },
      });
      mkdirSync(sessionWorkspaceDir(env), { recursive: true });
      const invocation = await runDeepAgentTurn(scenario);
      expect(invocation.outcome.kind).toBe("returned");
      const answer = seen.find((message) => (message as { tool_call_id?: string }).tool_call_id === "c-fetch");
      return typeof answer?.content === "string" ? answer.content : JSON.stringify(answer?.content ?? "");
    }

    it("refuses a web_fetch of this machine on a local runner, which a conversation with a computer may fetch", async () => {
      expect(await fetched(Computer.NONE)).toContain("Refusing to fetch 127.0.0.1");
      // The hermetic run refuses the network itself past the guard, so with
      // a computer the fetch is attempted and the guard's refusal is absent.
      expect(await fetched(Computer.REQUIRED)).not.toContain("Refusing to fetch");
    });

    it("fails the turn on an agent's own MCP server on this machine, naming it, before the model is asked", async () => {
      clock.reset();
      const record = deepAgentExecutionRecord({
        message: "Look the customer up.",
        computer: Computer.NONE,
        mcpServers: [{ name: "crm", url: `${pageUrl.replace("/admin", "")}/mcp` }],
      });
      const scenario = beginDeepAgentScenario({
        env,
        clock,
        record,
        script: () => {
          throw new Error("the model must never be asked when a server is refused");
        },
      });

      const invocation = await runDeepAgentTurn(scenario);

      expect(invocation.outcome.kind).toBe("returned");
      const final = record.lastFullStatus!;
      expect(final.phase).toBe(RunPhase.RUN_FAILED);
      expect(final.error).toMatch(/^MCP server '[^']*crm[^']*' is refused: a conversation without a computer reaches no machine of its own/);
      expect(final.error).toContain("Use a server on a public address, or give the agent a computer.");
    });
  });

  it("refuses the turn, before the model is asked, when a saved subagent has a computer", async () => {
    clock.reset();
    const worker = savedAgentFixture("worker", { description: "Works.", instructions: WORKER, computer: Computer.REQUIRED });
    const record = deepAgentExecutionRecord({ message: "Delegate.", subagents: [worker], computer: Computer.NONE });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => {
        throw new Error("the model must never be asked when the turn is refused");
      },
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    const final = record.lastFullStatus!;
    expect(final.phase).toBe(RunPhase.RUN_FAILED);
    expect(final.error).toContain("subagent 'worker'");
    expect(final.error).toContain("give the agent a computer");
  });

  it("offers both a shell when the conversation has a computer, recorded or from before the setting", async () => {
    for (const computer of [Computer.REQUIRED, undefined]) {
      const seen = await offered(computer);
      expect(seen.parent).toContain("execute");
      expect(seen.worker).toContain("execute");
    }
  });
});
