/**
 * Pins the Cursor delivery of a message sent while the turn works
 * (../turn-input.ts): at the runtime's hint the waiting messages are taken
 * and each text steered into the running run; one Cursor took is recorded
 * as delivered beside the SDK's store, one it reverted or that carries
 * files is owed to the round's end; the round's end asks once more and
 * answers every message the run took that Cursor does not have; a follow-up
 * send records what it carried; the record is the run's and survives the
 * invocation; a continued turn counts every message the run took before it
 * as delivered (its prompt carries them); and the follow-up's text lists a
 * message's files before it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnInputChannel, TurnMessage } from "../../../harness/turn-input.js";
import type { TurnSink } from "../../../harness/types.js";
import { DELIVERED_INPUTS_FILE, followUpText, newCursorTurnInput } from "../turn-input.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cursor-turn-input-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function message(id: string, text: string, extra: Partial<TurnMessage> = {}): TurnMessage {
  return { id, text, message: [], visionImages: [], visionNotViewable: [], ...extra };
}

const FILE = { fileId: "file_1", kind: "document" as const, mountPath: "spec.md", filename: "spec.md", mimeType: "text/markdown", sizeBytes: 3, relativePath: ".stigmer/uploads/spec.md" };

/** A queue standing where the runtime's channel stands: what waits, what the run took. */
function queue(): { readonly sink: TurnSink; send(m: TurnMessage): void; readonly taken: TurnMessage[] } {
  const waiting: TurnMessage[] = [];
  const taken: TurnMessage[] = [];
  const listeners = new Set<() => void>();
  const input: TurnInputChannel = {
    pending: () => waiting.length > 0,
    onPending: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    claim: async (options = {}) => {
      if (waiting.length === 0 && options.force !== true) return [];
      const claimed = waiting.splice(0);
      taken.push(...claimed);
      return claimed;
    },
    claimed: async (delivered) => taken.filter((m) => !delivered.has(m.id)),
  };
  return {
    sink: { input } as TurnSink,
    send(m) {
      waiting.push(m);
      for (const listener of [...listeners]) listener();
    },
    taken,
  };
}

function run(answer: "complete_delivered" | "revert_to_followup"): Run & { readonly steered: string[] } {
  const steered: string[] = [];
  return {
    steered,
    steer: vi.fn(async (text: string) => {
      steered.push(text);
      return answer;
    }),
  } as unknown as Run & { readonly steered: string[] };
}

describe("newCursorTurnInput", () => {
  it("steers a message into the running run at the hint, and owes nothing once Cursor took it", async () => {
    const q = queue();
    const input = await newCursorTurnInput(q.sink, "run_a", root, false);
    const live = run("complete_delivered");
    const stop = input.steerInto(live);
    q.send(message("m1", "also the README"));
    expect(await input.owed()).toEqual([]);
    stop();
    expect(live.steered).toEqual(["also the README"]);
    expect(JSON.parse(readFileSync(join(root, DELIVERED_INPUTS_FILE), "utf8"))).toEqual({ executionId: "run_a", ids: ["m1"] });
  });

  it("steers what already waits as the run starts", async () => {
    const q = queue();
    q.send(message("m1", "sent before the run"));
    const input = await newCursorTurnInput(q.sink, "run_a", root, false);
    const live = run("complete_delivered");
    const stop = input.steerInto(live);
    await vi.waitFor(() => expect(live.steered).toEqual(["sent before the run"]));
    stop();
    expect(await input.owed()).toEqual([]);
  });

  it("owes the round's end a message Cursor reverted, one that carries files, and one sent as the run ended", async () => {
    const q = queue();
    const input = await newCursorTurnInput(q.sink, "run_a", root, false);
    const live = run("revert_to_followup");
    const stop = input.steerInto(live);
    q.send(message("m1", "reverted"));
    q.send(message("m2", "with a file", { message: [FILE] }));
    await vi.waitFor(() => expect(live.steered).toEqual(["reverted"]));
    stop();
    q.send(message("m3", "as it ended"));
    const owed = await input.owed();
    expect(owed.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(live.steered).toEqual(["reverted"]);
    await input.delivered(owed);
    expect(await input.owed()).toEqual([]);
  });

  it("owes a message whose steer failed, and steers nothing into a run that cannot be steered", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const q = queue();
    const input = await newCursorTurnInput(q.sink, "run_a", root, false);
    const failing = { steer: vi.fn(async () => Promise.reject(new Error("gone"))) } as unknown as Run;
    const stop = input.steerInto(failing);
    q.send(message("m1", "one"));
    expect((await input.owed()).map((m) => m.id)).toEqual(["m1"]);
    stop();
    const unsteerable = input.steerInto({} as Run);
    q.send(message("m2", "two"));
    expect((await input.owed()).map((m) => m.id)).toEqual(["m1", "m2"]);
    unsteerable();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("reads the run's record, never another run's, and keeps none without a state root", async () => {
    writeFileSync(join(root, DELIVERED_INPUTS_FILE), JSON.stringify({ executionId: "run_a", ids: ["m1"] }));
    const q = queue();
    q.taken.push(message("m1", "steered before"), message("m2", "not yet"));
    expect((await (await newCursorTurnInput(q.sink, "run_a", root, false)).owed()).map((m) => m.id)).toEqual(["m2"]);
    expect((await (await newCursorTurnInput(q.sink, "run_b", root, false)).owed()).map((m) => m.id)).toEqual(["m1", "m2"]);
    const kept = await newCursorTurnInput(q.sink, "run_a", undefined, false);
    await kept.delivered([message("m2", "not yet")]);
    expect((await kept.owed()).map((m) => m.id)).toEqual(["m1"]);
  });

  it("lets a record it cannot open fail the turn's setup, as the sent-run record does", async () => {
    mkdirSync(join(root, DELIVERED_INPUTS_FILE));
    await expect(newCursorTurnInput(queue().sink, "run_a", root, false)).rejects.toThrow();
  });

  it("reads an unreadable record as none", async () => {
    writeFileSync(join(root, DELIVERED_INPUTS_FILE), "not json");
    const q = queue();
    q.taken.push(message("m1", "one"));
    expect((await (await newCursorTurnInput(q.sink, "run_a", root, false)).owed()).map((m) => m.id)).toEqual(["m1"]);
  });

  it("counts every message the run took before a continuation as delivered: its prompt carries them", async () => {
    const q = queue();
    q.taken.push(message("m1", "taken before the runner stopped"));
    const input = await newCursorTurnInput(q.sink, "run_a", root, true);
    expect(await input.owed()).toEqual([]);
  });
});

describe("followUpText", () => {
  it("is the messages' texts, each with its files listed before it", () => {
    const text = followUpText([message("m1", "one"), message("m2", "read this", { message: [FILE] })]);
    expect(text).toMatch(/^one\n\n<input_files>[\s\S]*\.stigmer\/uploads\/spec\.md[\s\S]*<\/input_files>\n\nread this$/);
  });
});
