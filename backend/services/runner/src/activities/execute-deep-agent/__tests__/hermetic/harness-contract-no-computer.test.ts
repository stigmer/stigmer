/**
 * The harness contract kit's adapter-side half against the REAL Stigmer
 * adapter in a conversation without a computer, beside the sibling that
 * runs it with one (`harness-contract.test.ts`).
 *
 * The subject is the sibling's engine with `withoutComputer`
 * (`__test-utils__/contract-subject.ts`, its header's last section): every
 * turn carries a workspace with no computer and the sqlite checkpointer, and
 * runs on the in-process loopback host (`__test-utils__/loopback-host.ts`),
 * so the turn's saved state crosses the pipe as relayed rows
 * (`shared/checkpointer/relayed-rows.ts`) through the real codec and the
 * runner's thread check (`agent-host/remote-adapter.ts`), and the host
 * stores them in the session's file under the hermetic `HOME`
 * (`agent-host/checkpoint-files.ts`). Such a turn has no shell and no file
 * on disk, so the kit's gated proposals are calls of a destructive MCP tool
 * on an HTTP server the subject names, which asks first as any destructive
 * tool does. What this proves: the relay, the store-backed file layer and
 * the contract hold for a turn without a computer. What it does not: the
 * lock, which no in-process host carries; the locked host's own boot and
 * Node's refusals are `scripts/verify-agent-host-boot.mjs --fenced`'s.
 *
 * Every adapter-side invariant runs here (1 to 8); none is declared not
 * applicable, since each plays only `say`, `propose`, `usage`, `hang` and
 * `fail`, which this subject translates.
 *
 * Not run here: the kit's runtime-side half (`runtime-contract.ts`). Its
 * driver builds the record itself and gives a subject no say in it, so a
 * conversation without a computer is not something it can stage, and its
 * arms lean on what such a conversation lacks: file review and the
 * workspace lock (a workspace), the long-turn and message arms (an `open`
 * that runs a shell), the compaction arm (a seeded file read). The runtime's
 * own handling of a conversation without a computer is pinned in
 * `no-computer.test.ts`.
 *
 * Beside the kit: one sqlite checkpoint per session lands under the
 * hermetic `HOME` through the relay, none for a session never served, and a
 * second turn of a session reads back the first turn's saved state.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { isAIMessage } from "@langchain/core/messages";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ExecutionDriver, describeHarnessContract } from "../../../../__test-utils__/harness-contract/contract.js";
import { scenario } from "../../../../__test-utils__/harness-contract/types.js";
import { ScriptedClock, createHermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { HttpMcpServer } from "../../../../__test-utils__/http-mcp-server.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { getCheckpointDbPath } from "../../../../shared/workspace/platform-dir.js";
import { CheckpointFiles } from "../../../../agent-host/checkpoint-files.js";
import { KIT_LEDGER_TOOLS, createDeepAgentContractSubject } from "../../__test-utils__/contract-subject.js";
import { ApprovalAction } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const ledger = new HttpMcpServer(KIT_LEDGER_TOOLS, async (_tool, args) => `recorded ${String(args["entry"])}`);
const subject = createDeepAgentContractSubject(env, { withoutComputer: { ledger } });
const RECORD = { kind: "write", resource: "/notes/kit.txt" } as const;

describe("ExecuteDeepAgent hermetic — the harness contract kit against the real adapter, without a computer", () => {
  let registry: ReturnType<typeof stubRegistryFetch>;

  beforeAll(async () => {
    await ledger.start();
    // The ledger is the one other origin a turn may dial.
    registry = stubRegistryFetch({ localOrigins: [ledger.url] });
    clock.install();
  });

  afterAll(async () => {
    clock.uninstall();
    registry.restore();
    env.dispose();
    await ledger.stop();
  });

  describeHarnessContract(subject);

  describe("the saved state, relayed", () => {
    beforeAll(async () => {
      await subject.adapter.boot(subject.config);
    });
    afterAll(async () => {
      await subject.adapter.shutdown();
    });

    it("keeps one sqlite checkpoint per session under the hermetic HOME through the relay, none for a session never served", async () => {
      const relayed = vi.spyOn(CheckpointFiles.prototype, "serve");
      const served = new ExecutionDriver(subject, "nc-sqlite-a");
      const other = new ExecutionDriver(subject, "nc-sqlite-b");
      expect((await served.turn([scenario.say("first")])).outcome.kind).toBe("completed");
      expect((await other.turn([scenario.say("second")])).outcome.kind).toBe("completed");
      const sessions = new Set(relayed.mock.calls.map(([sessionId]) => sessionId));
      relayed.mockRestore();
      expect(sessions, "each turn's saved state crossed as relayed rows, stored for its own session").toEqual(new Set([served.sessionId, other.sessionId]));

      const [a, b] = [getCheckpointDbPath(served.sessionId), getCheckpointDbPath(other.sessionId)];
      expect(a.startsWith(env.home), "the checkpoint lives under the runner-owned HOME tree").toBe(true);
      expect(a).not.toBe(b);
      expect(existsSync(a)).toBe(true);
      expect(existsSync(b)).toBe(true);
      expect(existsSync(getCheckpointDbPath("ses-never-served")), "a session never served has no checkpoint").toBe(false);
    });

    it("resumes an approved call from the relayed checkpoint: the call runs once, and the model reads the first turn's answer", async () => {
      const driver = new ExecutionDriver(subject, "nc-resume");
      const id = "nc-resume-record";
      const proposed = await driver.turn([scenario.say("asking first"), scenario.propose(id, RECORD)]);
      expect(proposed.outcome.kind).toBe("awaiting_approval");
      expect(subject.executionCount(id)).toBe(0);

      driver.decide(id, ApprovalAction.APPROVE);
      const resumed = await driver.turn([scenario.say("asking first"), scenario.propose(id, RECORD), scenario.say("recorded")]);
      expect(resumed.outcome.kind).toBe("completed");
      expect(subject.executionCount(id)).toBe(1);
      const transcript = subject.lastTranscriptOf(driver.executionId) ?? [];
      expect(
        transcript.filter((m) => isAIMessage(m)).map((m) => m.text),
        "the first turn's words came back from the relayed rows",
      ).toContain("asking first");
    });
  });
});
