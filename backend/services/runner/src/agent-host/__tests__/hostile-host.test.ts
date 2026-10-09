/**
 * The runner's side of the pipe against a host that does not follow the
 * rules. Whatever runs as the agent can take the host over, so the remote
 * adapter (`agent-host/remote-adapter.ts`) treats every value the host sends
 * as the agent's. This test is that host: it speaks the raw protocol
 * (`protocol.ts`) from a loopback channel, with no `serveAgentHost` between
 * it and the runner, and tries each thing the runner must refuse or bound:
 *
 *  - a persist that also carries runtime-owned fields: only the
 *    adapter-owned ones land;
 *  - a session-spec write that also sets the state id: only the fields an
 *    adapter owns carry over, and the id is still the runtime's write;
 *  - an upload outside the turn's own key prefix: refused, nothing stored;
 *  - usage with negative or non-finite counts: clamped to zero;
 *  - a plugin verify for a plugin the turn does not have: refused;
 *  - a notice for a turn that has settled: dropped.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { MessageType, RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { CursorMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { RecordingTurnSink } from "../../__test-utils__/harness-contract/recording-sink.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { HarnessAdapter } from "../../harness/types.js";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import { Peer, loopbackChannels } from "../channel.js";
import { encodeMessage } from "../codec.js";
import { assertTurnArtifactKey, createRemoteAdapter } from "../remote-adapter.js";
import { AgentHostSupervisor } from "../supervisor.js";
import {
  AGENT_HOST_PROTOCOL_VERSION,
  type HostCalls,
  type HostNotices,
  type RunnerCalls,
  type RunnerNotices,
  type WireSettlement,
} from "../protocol.js";

type HostilePeer = Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>;

/** What the hostile host does inside a turn, before it answers `runTurn`. */
type Attack = (peer: HostilePeer, turnId: string) => Promise<void>;

function hostileHarness(attack: Attack): HarnessAdapter {
  const proxy = { endpoint: "http://127.0.0.1:9", authorizeHost: () => {}, openTurn: () => () => {} };
  const supervisor = new AgentHostSupervisor({
    proxy,
    log: () => {},
    start: () => {
      const [runnerEnd, hostEnd] = loopbackChannels();
      const host: HostilePeer = new Peer<RunnerCalls, HostCalls, HostNotices, RunnerNotices>(hostEnd, "hostile host");
      host.handle("boot", async () => null);
      host.handle("shutdown", async () => null);
      host.handle("runTurn", async ({ turnId }): Promise<WireSettlement> => {
        await attack(host, turnId);
        return { outcome: { kind: "completed" }, thrown: null, projection: encodeMessage(RunStatusSchema, create(RunStatusSchema)), cas: null };
      });
      host.sendHello(AGENT_HOST_PROTOCOL_VERSION);
      return { channel: runnerEnd, kill: () => hostEnd.close() };
    },
  });
  const local: HarnessAdapter = {
    name: "hostile",
    capabilities: DEEP_AGENT_CAPABILITIES,
    boot: async () => {},
    shutdown: async () => {},
    releaseSession: async () => {},
    runTurn: async () => ({ kind: "completed" }),
  };
  return createRemoteAdapter("deep-agent", local, supervisor, proxy);
}

function recordingStorage(): { readonly storage: ArtifactStorage; readonly keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    storage: {
      upload: async (key) => {
        keys.push(key);
        return key;
      },
      download: async () => Buffer.alloc(0),
      exists: async () => false,
    },
  };
}

describe("a host that does not follow the rules", () => {
  it("lands only the adapter-owned fields of a persist", async () => {
    const adapter = hostileHarness(async (host, turnId) => {
      const forged = create(RunStatusSchema, {
        phase: RunPhase.RUN_COMPLETED,
        error: "forged by the host",
        startedAt: "forged",
        messages: [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, content: "the host's row" })],
      });
      await host.call("persist", { turnId, projection: encodeMessage(RunStatusSchema, forged) });
    });
    await adapter.boot(testConfig());
    const input = turnInputFixture();
    const sink = new RecordingTurnSink({ executionId: input.executionId, status: create(RunStatusSchema, { phase: RunPhase.RUN_IN_PROGRESS, startedAt: "t0" }) });

    await adapter.runTurn(input, sink);

    expect(sink.status.phase, "the phase is the runtime's").toBe(RunPhase.RUN_IN_PROGRESS);
    expect(sink.status.error).toBe("");
    expect(sink.status.startedAt).toBe("t0");
  });

  it("carries over only the session-spec fields an adapter owns; the state id stays the runtime's write", async () => {
    const adapter = hostileHarness(async (host, turnId) => {
      const spec = create(SessionSpecSchema, { harnessStateId: "forged-in-the-spec", cursorMode: CursorMode.LOCAL, subject: "forged subject" });
      await host.call("bindHarnessState", { turnId, harnessStateId: "bound-id", sessionSpec: encodeMessage(SessionSpecSchema, spec) });
    });
    await adapter.boot(testConfig());
    const input = turnInputFixture();
    const sink = new RecordingTurnSink({ executionId: input.executionId });

    await adapter.runTurn(input, sink);

    expect(input.session.spec!.cursorMode, "the adapter's own field").toBe(CursorMode.LOCAL);
    expect(input.session.spec!.subject, "a field no adapter owns").toBe("");
    expect(input.session.spec!.harnessStateId, "the runtime's sink writes the id, not the spec").toBe("");
    expect(sink.boundStateIds).toEqual(["bound-id"]);
  });

  it("refuses an upload outside the turn's own key prefix", async () => {
    const errors: string[] = [];
    const adapter = hostileHarness(async (host, turnId) => {
      for (const key of ["artifacts/aex_other/secret.txt", "artifacts/aex_fixture_0001/../aex_other/x", "checkpoints/x", "artifacts/aex_fixture_0001/"]) {
        await host.call("uploadArtifact", { turnId, key, content: "", contentType: null }).catch((err: Error) => errors.push(err.message));
      }
      await host.call("uploadArtifact", { turnId, key: "artifacts/aex_fixture_0001/report.md", content: Buffer.from("ok").toString("base64"), contentType: "text/markdown" });
    });
    await adapter.boot(testConfig());
    const { storage, keys } = recordingStorage();
    const input = turnInputFixture({ artifactStorage: storage });

    await adapter.runTurn(input, new RecordingTurnSink({ executionId: input.executionId }));

    expect(errors).toHaveLength(4);
    expect(keys, "only the turn's own key reached the store").toEqual(["artifacts/aex_fixture_0001/report.md"]);
  });

  it("clamps usage counts to finite, non-negative numbers", async () => {
    const adapter = hostileHarness(async (host, turnId) => {
      host.notify("usage", { turnId, delta: { inputTokens: -1_000_000, outputTokens: Number.NaN, estimatedCostUsd: -5, cacheReadTokens: 12 } });
      await host.call("reportProgress", { turnId, label: "flush" });
    });
    await adapter.boot(testConfig());
    const input = turnInputFixture();
    const sink = new RecordingTurnSink({ executionId: input.executionId });

    await adapter.runTurn(input, sink);

    expect(sink.usageDeltas).toEqual([expect.objectContaining({ inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, cacheReadTokens: 12 })]);
  });

  it("refuses a verify for a plugin the turn does not have", async () => {
    let refusal = "";
    const adapter = hostileHarness(async (host, turnId) => {
      await host.call("verifyPlugin", { turnId, slug: "not-mine" }).catch((err: Error) => {
        refusal = err.message;
      });
    });
    await adapter.boot(testConfig());
    const input = turnInputFixture();

    await adapter.runTurn(input, new RecordingTurnSink({ executionId: input.executionId }));

    expect(refusal).toBe("plugin 'not-mine' is not one of this turn's");
  });

  it("drops a notice for a turn that has settled", async () => {
    const adapter = hostileHarness(async (host, turnId) => {
      // Sent once the runTurn answer is on its way: a late fact about a turn the runtime has settled.
      setTimeout(() => host.notify("usage", { turnId, delta: { inputTokens: 999 } }), 0);
    });
    await adapter.boot(testConfig());
    const input = turnInputFixture();
    const sink = new RecordingTurnSink({ executionId: input.executionId });

    await adapter.runTurn(input, sink);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sink.usageDeltas).toEqual([]);
  });
});

describe("the turn's artifact prefix", () => {
  it.each([
    ["artifacts/aex_1/report.md", true],
    ["artifacts/aex_1/nested/report.md", true],
    ["artifacts/aex_2/report.md", false],
    ["artifacts/aex_1/../aex_2/report.md", false],
    ["artifacts/aex_1/./report.md", false],
    ["artifacts/aex_1//report.md", false],
    ["artifacts/aex_1\\report.md", false],
    ["artifacts/aex_1/", false],
  ])("%s → %s", (key, allowed) => {
    if (allowed) expect(() => assertTurnArtifactKey(key, "aex_1")).not.toThrow();
    else expect(() => assertTurnArtifactKey(key, "aex_1")).toThrow(/outside this turn's prefix/);
  });
});
