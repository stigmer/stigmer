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
 *  - an adapter reads its run's events through the runner, each crossing
 *    whole;
 *  - the turn's input channel crosses: the hint as the turn began and each
 *    time it rises, a claim the runner answers with whether more wait (and
 *    none made while nothing waits), and what the run took.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionEventSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import type { HarnessAdapter } from "../../harness/types.js";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { TURN_KEY_HEADER, turnKeyHeader } from "../../shared/execution-context.js";
import { Peer, loopbackChannels } from "../channel.js";
import { decodeMessage, encodeMessage, encodeRunEvents, encodeTurnInput } from "../codec.js";
import { serveAgentHost } from "../host.js";
import type { HostCalls, HostNotices, RunnerCalls, RunnerNotices } from "../protocol.js";
import { TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

/** A store the runtime resolved; the host only learns there is one. */
const STORE: ArtifactStorage = {
  upload: async (key) => key,
  download: async () => Buffer.alloc(0),
  exists: async () => false,
};

function served(runTurn: HarnessAdapter["runTurn"], yielded = false, inputPending = false) {
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
      rows: encodeMessage(TurnRowsSchema, create(TurnRowsSchema)),
      timing: new TimingRecorder().toWire(),
      fingerprintKey: Buffer.alloc(32).toString("base64"),
      stopped: null,
      yielded,
      inputPending,
      turnKey: "turn-key-test",
      traceparent: null,
    });
  return { runner, call };
}

describe("the agent host's server", () => {
  it("hands the adapter a yield the runtime asked before the turn, and one it asks mid-turn", async () => {
    const before = served(async (_input, sink) => (sink.yieldSignal.aborted ? { kind: "interrupted" } : { kind: "completed" }), true);
    expect((await before.call()).outcome).toEqual({ kind: "interrupted" });

    let entered: () => void = () => {};
    const inTurn = new Promise<void>((resolve) => (entered = resolve));
    const during = served(async (_input, sink) => {
      entered();
      await new Promise<void>((resolve) => sink.yieldSignal.addEventListener("abort", () => resolve(), { once: true }));
      return { kind: "interrupted" };
    });
    const settling = during.call();
    await inTurn;
    during.runner.notify("yieldTurn", { turnId: "t1" });
    expect((await settling).outcome).toEqual({ kind: "interrupted" });
  });

  it("carries the turn's input channel over the pipe", async () => {
    const message = (id: string) => ({ id, text: id, message: [], visionImages: [], visionNotViewable: [] });
    const forced: boolean[] = [];
    const seen: unknown[] = [];
    let entered: () => void = () => {};
    const inTurn = new Promise<void>((resolve) => (entered = resolve));
    let rise: () => void = () => {};
    const rose = new Promise<void>((resolve) => (rise = resolve));
    const { runner, call } = served(
      async (_input, sink) => {
        seen.push(sink.input.pending());
        seen.push((await sink.input.claim()).map((m) => m.id));
        seen.push(sink.input.pending());
        seen.push(await sink.input.claim());
        const leave = sink.input.onPending(rise);
        entered();
        await rose;
        leave();
        seen.push((await sink.input.claimed(new Set(["m1"]))).map((m) => m.id));
        return { kind: "completed" };
      },
      false,
      true,
    );
    runner.handle("claimInput", async ({ force }) => {
      forced.push(force);
      return { messages: [message("m1")], pending: false };
    });
    runner.handle("claimedInput", async ({ delivered }) => [message("m1"), message("m2")].filter((m) => !delivered.includes(m.id)));
    const settling = call();
    await inTurn;
    runner.notify("inputPending", { turnId: "t1" });
    runner.notify("inputPending", { turnId: "t1" });
    expect((await settling).outcome).toEqual({ kind: "completed" });
    expect(seen).toEqual([true, ["m1"], false, [], ["m2"]]);
    expect(forced, "one claim crossed, unforced; none while nothing waited").toEqual([false]);
  });

  it("hands the adapter a person's stop of a background command, by its call id, until it leaves", async () => {
    const heard: string[] = [];
    let entered: () => void = () => {};
    const inTurn = new Promise<void>((resolve) => (entered = resolve));
    let stopped: () => void = () => {};
    const both = new Promise<void>((resolve) => (stopped = resolve));
    const { runner, call } = served(async (_input, sink) => {
      const leave = sink.backgroundStops.onStop((callId) => {
        heard.push(callId);
        if (heard.length === 2) stopped();
      });
      entered();
      await both;
      leave();
      return { kind: "completed" };
    });
    const settling = call();
    await inTurn;
    runner.notify("stopBackgroundCommand", { turnId: "t1", callId: "bg-1" });
    runner.notify("stopBackgroundCommand", { turnId: "t-other", callId: "bg-x" });
    runner.notify("stopBackgroundCommand", { turnId: "t1", callId: "bg-2" });
    expect((await settling).outcome).toEqual({ kind: "completed" });
    expect(heard, "a stop for another turn reaches no one").toEqual(["bg-1", "bg-2"]);
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
    expect(decodeMessage(TurnRowsSchema, settlement.projection.rows).messages.map((m) => m.content)).toEqual(["folded first"]);
  });

  it("carries a throw that is not an Error as its text", async () => {
    const { call } = served(async () => {
      throw "a bare string";
    });
    expect((await call()).thrown).toEqual({ name: "Error", message: "a bare string" });
  });

  it("tells the engine the runner has a store and serves none of it", async () => {
    let uses: string[] = [];
    const { call } = served(async (input) => {
      const storage = input.artifactStorage!;
      uses = await Promise.all([
        storage.upload(`artifacts/${input.executionId}/a.txt`, Buffer.from("a"), "text/plain").then(String, (err: Error) => err.message),
        storage.download("artifacts/other/secret").then(String, (err: Error) => err.message),
        storage.exists("artifacts/other/secret").then(String, (err: Error) => err.message),
      ]);
      return { kind: "completed" };
    });

    await call();
    expect(uses).toEqual([
      "agent host: the artifact store is the runner's (artifacts/aex_fixture_0001/a.txt)",
      "agent host: the artifact store is the runner's (artifacts/other/secret)",
      "agent host: the artifact store is the runner's (artifacts/other/secret)",
    ]);
  });

  it("reads the run's events through the runner, each event whole", async () => {
    const event = create(SessionEventSchema, {
      runId: "aex_fixture_0001",
      event: { case: "agentMessage", value: { id: "aex_fixture_0001.root.m0", content: [{ type: "text", text: "so far" }] } },
    });
    let read: string[] = [];
    const { runner, call } = served(async (input) => {
      read = (await input.readRunEvents()).map((e) => (e.event.case === "agentMessage" ? e.event.value.id : ""));
      return { kind: "completed" };
    });
    const asked: string[] = [];
    runner.handle("readRunEvents", async ({ turnId }) => {
      asked.push(turnId);
      return encodeRunEvents([event]);
    });

    await call();
    expect(asked).toEqual(["t1"]);
    expect(read).toEqual(["aex_fixture_0001.root.m0"]);
  });
});
