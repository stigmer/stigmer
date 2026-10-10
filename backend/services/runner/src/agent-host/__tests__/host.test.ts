/**
 * The agent host's server (`agent-host/host.ts`) at the edges the remote
 * adapter's own tests do not reach, driven over a loopback channel by a
 * test that speaks the runner's side.
 *
 * Pinned:
 *  - a CAS read for a turn whose adapter bound no reader is an error, never
 *    an empty snapshot the runtime would take for "nothing touched";
 *  - an adapter that throws is answered with the throw and the rows it
 *    folded first, never a rejected call that loses them;
 *  - the host's artifact store uploads through the runner and refuses
 *    reads: the engines only upload, and a read would be a path into the
 *    runner's whole store;
 *  - the Cursor SDK's warm-up runs in the host, and its result crosses whole.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { HarnessAdapter } from "../../harness/types.js";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { TURN_KEY_HEADER, turnKeyHeader } from "../../shared/execution-context.js";
import { Peer, loopbackChannels } from "../channel.js";
import { decodeMessage, encodeMessage, encodeTurnInput } from "../codec.js";
import { serveAgentHost } from "../host.js";
import type { HostCalls, HostNotices, RunnerCalls, RunnerNotices } from "../protocol.js";

/** A store the runtime resolved; the host only learns there is one. */
const STORE: ArtifactStorage = {
  upload: async (key) => key,
  download: async () => Buffer.alloc(0),
  exists: async () => false,
};

vi.mock("../../activities/execute-cursor/sdk-warmup.js", () => ({
  warmCursorSdkStateStores: async () => ({ warmed: false, durationMs: 1.5, error: "no SDK in this test" }),
}));

function served(runTurn: HarnessAdapter["runTurn"]) {
  const [runnerEnd, hostEnd] = loopbackChannels();
  const adapter: HarnessAdapter = {
    name: "probe",
    capabilities: DEEP_AGENT_CAPABILITIES,
    boot: async () => {},
    shutdown: async () => {},
    releaseSession: async () => {},
    runTurn,
  };
  serveAgentHost(hostEnd, [{ harness: "deep-agent", adapter }]);
  const runner = new Peer<HostCalls, RunnerCalls, RunnerNotices, HostNotices>(runnerEnd, "runner");
  const call = () =>
    runner.call("runTurn", {
      turnId: "t1",
      harness: "deep-agent",
      input: encodeTurnInput(turnInputFixture({ artifactStorage: STORE })),
      status: encodeMessage(RunStatusSchema, create(RunStatusSchema)),
      timing: new TimingRecorder().toWire(),
      fingerprintKey: Buffer.alloc(32).toString("base64"),
      stopped: null,
      turnKey: "turn-key-test",
    });
  return { runner, call };
}

describe("the agent host's server", () => {
  it("warms the Cursor SDK in the host and answers with the result", async () => {
    const { runner } = served(async () => ({ kind: "completed" }));
    expect(await runner.call("warmCursorSdk", {})).toEqual({ warmed: false, durationMs: 1.5, error: "no SDK in this test" });
  });

  it("answers a CAS read for a turn with no bound reader with an error", async () => {
    const { runner } = served(async () => ({ kind: "completed" }));
    await expect(runner.call("readCasObservations", { turnId: "t-none" })).rejects.toThrow("agent host: no CAS observations bound for turn t-none");
  });

  it("runs the adapter's turn under the key the runner handed, which every call to the runner's proxy carries", async () => {
    let carried: Record<string, string> = {};
    const { call } = served(async () => {
      carried = turnKeyHeader();
      return { kind: "completed" };
    });
    await call();
    expect(carried).toEqual({ [TURN_KEY_HEADER]: "turn-key-test" });
    expect(turnKeyHeader(), "and outside the turn, none").toEqual({});
  });

  it("answers an adapter's throw with the throw and the rows it folded first", async () => {
    const { call } = served(async (_input, sink) => {
      sink.transcript.apply({ kind: "message_start", runId: "r" });
      sink.transcript.apply({ kind: "text_delta", runId: "r", text: "folded first" });
      throw new TypeError("broke the contract");
    });

    const settlement = await call();
    expect(settlement.outcome).toBeNull();
    expect(settlement.thrown).toEqual(expect.objectContaining({ name: "TypeError", message: "broke the contract" }));
    expect(decodeMessage(RunStatusSchema, settlement.projection).messages.map((m) => m.content)).toEqual(["folded first"]);
  });

  it("carries a throw that is not an Error as its text", async () => {
    const { call } = served(async () => {
      throw "a bare string";
    });
    expect((await call()).thrown).toEqual({ name: "Error", message: "a bare string" });
  });

  it("uploads through the runner and refuses reads of the store", async () => {
    let reads: string[] = [];
    const { runner, call } = served(async (input) => {
      const storage = input.artifactStorage!;
      await storage.upload(`artifacts/${input.executionId}/a.txt`, Buffer.from("a"), "text/plain");
      reads = await Promise.all([
        storage.download("artifacts/other/secret").then(String, (err: Error) => err.message),
        storage.exists("artifacts/other/secret").then(String, (err: Error) => err.message),
      ]);
      return { kind: "completed" };
    });
    const uploads: string[] = [];
    runner.handle("uploadArtifact", async ({ key, contentType }) => {
      uploads.push(`${key} ${contentType}`);
      return key;
    });

    await call();
    expect(uploads).toEqual(["artifacts/aex_fixture_0001/a.txt text/plain"]);
    expect(reads).toEqual([
      "agent host: artifact reads are not served (artifacts/other/secret)",
      "agent host: artifact reads are not served (artifacts/other/secret)",
    ]);
  });
});
