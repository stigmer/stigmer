/**
 * The agent host's calls reach the runtime in the turn's own async context
 * (`agent-host/remote-adapter.ts`), as an in-process adapter's calls do: a
 * read the hosted engine asks of the runtime (here what the run took while
 * it worked, which reads the session's log) goes out with the run
 * credential the activity entered, never the process's own.
 */
import { describe, expect, it } from "vitest";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { RecordingTurnSink } from "../../__test-utils__/harness-contract/recording-sink.js";
import { loopbackHostedRow } from "../../__test-utils__/loopback-host.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import { NO_TURN_INPUT } from "../../harness/turn-input.js";
import { currentRunCredential, withRunCredential } from "../../shared/run-credential-store.js";

describe("the agent host's calls to the runtime", () => {
  it("run in the turn's context, with the run credential the activity entered", async () => {
    const seenBy: Array<string | undefined> = [];
    const row = loopbackHostedRow({
      harness: "deep-agent",
      adapter: {
        name: "context-probe",
        capabilities: DEEP_AGENT_CAPABILITIES,
        boot: async () => {},
        shutdown: async () => {},
        releaseSession: async () => {},
        runTurn: async (_input, sink) => {
          await sink.input.claimed(new Set());
          await sink.requestPersist();
          return { kind: "completed" };
        },
      },
    });
    await row.adapter.boot(testConfig());
    const sink = new (class extends RecordingTurnSink {
      override async requestPersist(): Promise<void> {
        seenBy.push(currentRunCredential());
        await super.requestPersist();
      }
    })({
      input: {
        ...NO_TURN_INPUT,
        claimed: async () => {
          seenBy.push(currentRunCredential());
          return [];
        },
      },
    });

    // The host starts, and its pipe opens, before this turn: its lines
    // arrive in the context the pipe was opened in, never this turn's.
    await row.adapter.runTurn(turnInputFixture(), new RecordingTurnSink());
    seenBy.splice(0);
    await withRunCredential("run-credential", () => row.adapter.runTurn(turnInputFixture(), sink));

    expect(seenBy).toEqual(["run-credential", "run-credential"]);
  });
});
