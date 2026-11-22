/**
 * The agent host's calls reach the runtime in the turn's own async context
 * (`agent-host/remote-adapter.ts`), as an in-process adapter's calls do: a
 * read the hosted engine asks of the runtime (here what the run took while
 * it worked, which reads the session's log) goes out with the run
 * credential the activity entered, never the process's own. So does a read
 * of the turn's skill files: two turns of two organizations, running at
 * once through one host, each read under its own run credential.
 */
import { describe, expect, it } from "vitest";

import { DEEP_AGENT_CAPABILITIES } from "../../activities/execute-deep-agent/deep-agent-capabilities.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { RecordingTurnSink } from "../../__test-utils__/harness-contract/recording-sink.js";
import { loopbackHostedRow } from "../../__test-utils__/loopback-host.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import { NO_TURN_INPUT } from "../../harness/turn-input.js";
import { currentRunCredential, withRunCredential } from "../../shared/run-credential-store.js";
import { ArchiveFileNotFoundError, type TurnArchiveFiles } from "../../shared/archive-reader.js";
import { InputFileNotFoundError } from "../../shared/inputs-reader.js";
import { newOutputsBuffer } from "../../shared/outputs-buffer.js";
import type { TurnStoreFiles } from "../../harness/types.js";

describe("the agent host's calls to the runtime", () => {
  it("run in the turn's context, with the run credential the activity entered", async () => {
    const seenBy: Array<string | undefined> = [];
    const row = loopbackHostedRow({
      harness: "stigmer",
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

  it("read the turn's skill files under that turn's credential, for two organizations' turns at once", async () => {
    const reads: Array<{ readonly turn: string; readonly credential: string | undefined; readonly text: string }> = [];
    const archivesOf = (turn: string): TurnArchiveFiles => ({
      folders: ["skills"],
      list: async () => [{ path: "skills/notes/SKILL.md", size: turn.length, sha256: "a".repeat(64), executable: false }],
      read: async () => {
        // A turn's read waits for the other's to start, so the two overlap.
        await new Promise((resolve) => setTimeout(resolve, 20));
        reads.push({ turn, credential: currentRunCredential(), text: turn });
        return new TextEncoder().encode(turn);
      },
    });
    const row = loopbackHostedRow({
      harness: "stigmer",
      adapter: {
        name: "archive-probe",
        capabilities: DEEP_AGENT_CAPABILITIES,
        boot: async () => {},
        shutdown: async () => {},
        releaseSession: async () => {},
        runTurn: async (input) => {
          // The warm-up turn, which starts the host, has no skills.
          if (input.skills.archives === undefined) return { kind: "completed" };
          const text = new TextDecoder().decode(await input.skills.archives.read("skills/notes/SKILL.md"));
          return text === input.executionId ? { kind: "completed" } : { kind: "failed", surface: "internal", message: `read ${text}` };
        },
      },
    });
    await row.adapter.boot(testConfig());
    await row.adapter.runTurn(turnInputFixture(), new RecordingTurnSink());
    const turn = (org: string) =>
      withRunCredential(`credential-of-${org}`, () =>
        row.adapter.runTurn(
          turnInputFixture({ executionId: org, skills: { root: [], bySubAgent: new Map(), archives: archivesOf(org) } }),
          new RecordingTurnSink(),
        ),
      );

    const outcomes = await Promise.all([turn("org-a"), turn("org-b")]);

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["completed", "completed"]);
    expect([...reads].sort((a, b) => a.turn.localeCompare(b.turn))).toEqual([
      { turn: "org-a", credential: "credential-of-org-a", text: "org-a" },
      { turn: "org-b", credential: "credential-of-org-b", text: "org-b" },
    ]);
  });

  it("answer a file the turn does not hold as not found, across the host, whether the turn has no skills or the file is not one of them", async () => {
    const answers: string[] = [];
    const row = loopbackHostedRow({
      harness: "stigmer",
      adapter: {
        name: "missing-probe",
        capabilities: DEEP_AGENT_CAPABILITIES,
        boot: async () => {},
        shutdown: async () => {},
        releaseSession: async () => {},
        runTurn: async (input) => {
          if (input.executionId === "warm-up") return { kind: "completed" };
          const read = input.skills.archives?.read ?? (() => Promise.reject(new Error("no reader")));
          await read("skills/notes/nothing.md").then(
            () => answers.push("served"),
            (err: unknown) => answers.push(err instanceof ArchiveFileNotFoundError ? `not found: ${err.path}` : String(err)),
          );
          return { kind: "completed" };
        },
      },
    });
    await row.adapter.boot(testConfig());
    await row.adapter.runTurn(turnInputFixture({ executionId: "warm-up" }), new RecordingTurnSink());
    const holding: TurnArchiveFiles = {
      folders: ["skills"],
      list: async () => [],
      read: async (path) => Promise.reject(new ArchiveFileNotFoundError(path)),
    };
    await row.adapter.runTurn(turnInputFixture({ executionId: "holds-none", skills: { root: [], bySubAgent: new Map(), archives: holding } }), new RecordingTurnSink());
    const failing: TurnArchiveFiles = { ...holding, read: async () => Promise.reject(new Error("the store is unreachable")) };
    await row.adapter.runTurn(turnInputFixture({ executionId: "store-down", skills: { root: [], bySubAgent: new Map(), archives: failing } }), new RecordingTurnSink());

    expect(answers[0]).toBe("not found: skills/notes/nothing.md");
    expect(answers[1], "any other failure crosses as itself, never as not found").toContain("the store is unreachable");
  });

  it("serve a turn without a computer its files across the host, each call answered by the runner", async () => {
    const seen: Record<string, unknown> = {};
    const row = loopbackHostedRow({
      harness: "stigmer",
      adapter: {
        name: "store-probe",
        capabilities: DEEP_AGENT_CAPABILITIES,
        boot: async () => {},
        shutdown: async () => {},
        releaseSession: async () => {},
        runTurn: async (input) => {
          if (input.workspace.computer) return { kind: "completed" };
          const { inputs, outputs, offloads } = input.workspace.files;
          seen.listed = (await inputs.list()).map((file) => file.path);
          seen.read = new TextDecoder().decode(await inputs.read("uploads/brief.txt"));
          seen.missing = await inputs.read("uploads/none.txt").then(
            () => "found",
            (err: unknown) => (err instanceof InputFileNotFoundError ? "not found" : String(err)),
          );
          await outputs.write("reply.md", new TextEncoder().encode("v1"));
          seen.output = new TextDecoder().decode((await outputs.read("reply.md")) ?? new Uint8Array());
          seen.outputs = (await outputs.list()).map((file) => file.path);
          seen.noOutput = await outputs.read("none.md");
          seen.deleted = await outputs.delete("reply.md");
          const key = await offloads!.put(new TextEncoder().encode("kept"));
          seen.kept = new TextDecoder().decode(await offloads!.read(key));
          return { kind: "completed" };
        },
      },
    });
    await row.adapter.boot(testConfig());
    const files = new Map([["uploads/brief.txt", "brief"]]);
    const kept = new Map<string, Uint8Array>();
    const store: TurnStoreFiles = {
      inputs: {
        list: async () => [...files.keys()].map((path) => ({ path, size: 5, fileId: "file_1", mimeType: "text/plain" })),
        read: async (path) => {
          const text = files.get(path);
          if (text === undefined) throw new InputFileNotFoundError(path);
          return new TextEncoder().encode(text);
        },
      },
      outputs: newOutputsBuffer(),
      offloads: {
        put: async (bytes) => {
          kept.set("key_1", bytes);
          return "key_1";
        },
        read: async (key) => kept.get(key) ?? new Uint8Array(),
      },
    };

    await row.adapter.runTurn({ ...turnInputFixture(), workspace: { computer: false, files: store } }, new RecordingTurnSink());

    expect(seen).toEqual({
      listed: ["uploads/brief.txt"],
      read: "brief",
      missing: "not found",
      output: "v1",
      outputs: ["reply.md"],
      noOutput: undefined,
      deleted: true,
      kept: "kept",
    });
  });
});
