/**
 * Pins what a Claude session's saved transcript is read to say
 * (`transcript-facts.ts`): whether it exists, which message ids it took
 * (as a user entry's own id, or as an absorbed mid-turn message's
 * `source_uuid`), and whether the engine had finished the run.
 *
 * Why it matters: these facts decide whether an invocation hands the engine
 * the task again. Each unknown or missing field must read "not taken" and
 * "not finished", the safe direction, so a changed transcript format makes
 * the engine ask again rather than silently skip work.
 */

import { describe, it, expect } from "vitest";
import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

import { transcriptFactsOf } from "../transcript-facts.js";

function user(uuid: string, extra: Partial<SessionStoreEntry> = {}): SessionStoreEntry {
  return { type: "user", uuid, message: { role: "user", content: "task" }, ...extra };
}

function assistant(uuid: string, content: readonly unknown[], extra: Partial<SessionStoreEntry> = {}): SessionStoreEntry {
  return { type: "assistant", uuid, message: { role: "assistant", content }, ...extra };
}

function absorbed(sourceUuid: unknown): SessionStoreEntry {
  return { type: "attachment", uuid: "att-1", attachment: { type: "queued_command", source_uuid: sourceUuid } };
}

describe("transcriptFactsOf", () => {
  it("reads a never-written transcript as absent, nothing taken, not finished", () => {
    const facts = transcriptFactsOf(null);
    expect(facts.exists).toBe(false);
    expect([...facts.taken]).toEqual([]);
    expect(facts.finished).toBe(false);
  });

  it("reads an empty transcript as existing but unfinished", () => {
    expect(transcriptFactsOf([])).toEqual({ exists: true, taken: new Set(), finished: false });
  });

  it("takes every user entry's own id", () => {
    const facts = transcriptFactsOf([user("u-1"), assistant("a-1", [{ type: "text", text: "ok" }]), user("u-2")]);
    expect([...facts.taken]).toEqual(["u-1", "u-2"]);
  });

  it("takes an absorbed mid-turn message by its source id", () => {
    const facts = transcriptFactsOf([user("u-1"), absorbed("sent-1")]);
    expect(facts.taken.has("sent-1")).toBe(true);
    expect(facts.taken.has("att-1")).toBe(false);
  });

  it("takes nothing from an attachment without a string source id, nor from a source id on another entry type", () => {
    const facts = transcriptFactsOf([
      absorbed(7),
      { type: "attachment", uuid: "att-2" },
      { type: "system", uuid: "s-1", attachment: { source_uuid: "not-an-attachment" } },
    ]);
    expect([...facts.taken]).toEqual([]);
  });

  it("takes no user entry without a string id", () => {
    const facts = transcriptFactsOf([{ type: "user", message: { role: "user", content: "x" } }]);
    expect([...facts.taken]).toEqual([]);
  });

  it("reads a run as finished when the main thread's last word is the model's with no tool call", () => {
    expect(transcriptFactsOf([user("u-1"), assistant("a-1", [{ type: "text", text: "done" }])]).finished).toBe(true);
  });

  it("reads a run as unfinished when the model's last word calls a tool", () => {
    const entries = [user("u-1"), assistant("a-1", [{ type: "text", text: "running" }, { type: "tool_use", id: "toolu_1", name: "Bash", input: {} }])];
    expect(transcriptFactsOf(entries).finished).toBe(false);
  });

  it("reads a run as unfinished when the main thread's last word is a user entry (a tool result)", () => {
    const entries = [user("u-1"), assistant("a-1", [{ type: "tool_use", id: "toolu_1", name: "Bash", input: {} }]), user("u-2")];
    expect(transcriptFactsOf(entries).finished).toBe(false);
  });

  it("ignores a sub-agent's sidechain when judging the main thread's last word", () => {
    const entries = [
      user("u-1"),
      assistant("a-1", [{ type: "text", text: "done" }]),
      user("side-u", { isSidechain: true }),
      assistant("side-a", [{ type: "tool_use", id: "toolu_side", name: "Read", input: {} }], { isSidechain: true }),
    ];
    expect(transcriptFactsOf(entries).finished).toBe(true);
  });

  it("ignores entries that are neither user nor assistant when judging the last word", () => {
    const entries = [user("u-1"), assistant("a-1", [{ type: "text", text: "done" }]), { type: "summary", uuid: "s-1" }, absorbed("sent-9")];
    expect(transcriptFactsOf(entries).finished).toBe(true);
  });

  it("reads an assistant entry whose content is not a block list as calling no tool", () => {
    expect(transcriptFactsOf([user("u-1"), { type: "assistant", uuid: "a-1", message: { role: "assistant", content: "plain" } }]).finished).toBe(true);
    expect(transcriptFactsOf([user("u-1"), { type: "assistant", uuid: "a-2" }]).finished).toBe(true);
  });
});
