// Unit arms for the session driver's path that never reaches a stack: a
// session whose first turn was refused at create.
// Domain: conformance benchmark.
//
// Pinned: the refusal stays on the first turn's sample in the platform's own
// words; every later turn has no session to run in and is recorded as failed
// at create, never skipped; such a sample carries no background readings, no
// checks of the work and nothing a command printed.
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { measureSession, type SessionStack } from "../session";

describe("measureSession", () => {
  it("records a refused first turn, and every later turn of the session it never made, as failed at create", async () => {
    const stack: SessionStack = {
      clients: {
        agentExecutionCommand: {
          create: async () => {
            throw new Error("[resource_exhausted] the organization's run quota is spent");
          },
        },
      } as unknown as ConformanceClients,
      runnerLogFile: "/nowhere/runner.log",
      temporal: { hostPort: "127.0.0.1:1", namespace: "default" },
    };
    const lines: string[] = [];

    const turns = await measureSession(
      stack,
      {
        org: "org_1",
        agentRef: { org: "org_1", slug: "agent" },
        harness: "stigmer",
        modelRequested: "claude-sonnet-4.6",
        sessionSpec: { subject: "refused" },
        prompts: ["one", "two", "three"],
        label: "unit/refused",
      },
      { log: (line) => lines.push(line) },
    );

    expect(turns.map((turn) => turn.sample.failure)).toEqual([
      { stage: "create", message: "[resource_exhausted] the organization's run quota is spent" },
      { stage: "create", message: "no session: the session's first turn was never created" },
      { stage: "create", message: "no session: the session's first turn was never created" },
    ]);
    for (const turn of turns) {
      expect(turn.sample).toMatchObject({ outcome: "failed", model_requested: "claude-sonnet-4.6", background: null, task_done: null });
      expect(turn.reply).toBe("");
      expect(turn.commandOutputs).toEqual([]);
    }
    expect(lines).toEqual(["unit/refused.1: create refused: [resource_exhausted] the organization's run quota is spent"]);
  });
});
