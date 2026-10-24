// Tests for the plaintext renderer, drawn from the fold: the person's message
// and every status line go to the status sink, the agent's primary-thread
// messages to the data sink; a tool use gets a line each time its state
// changes (running, waiting, completed, failed with the head of its output,
// denied, interrupted), titled by a shell call's intent; a subagent's start,
// its tool uses indented beneath, and its end, its messages left out; notes,
// compactions and the turn's errors once each; a background command's line
// each time its state changes; how an ask was answered; a
// turn the fold did not touch is not written again; thinking is silent.

import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { foldSession, type ToolUse } from "@stigmer/client";
import { describe, expect, it } from "vitest";
import {
  asked,
  background,
  confirmed,
  ev,
  failure,
  note,
  phase,
  result,
  said,
  threadIdle,
  threadRunning,
  use,
  user,
} from "../../__test-utils__/session-events.js";
import { answerFor } from "../answer.js";
import { PlaintextRenderer } from "../render-plaintext.js";

const R = "run_a";

function renderer() {
  let data = "";
  let status = "";
  const r = new PlaintextRenderer({ data: { write: (s) => void (data += s) }, status: { write: (s) => void (status += s) } });
  return { r, data: () => data, status: () => status };
}

/** Fold every growing prefix of `events`, as a live stream would. */
function stream(events: SessionEvent[]) {
  const ctx = renderer();
  for (let i = 1; i <= events.length; i++) ctx.r.fold(foldSession(events.slice(0, i)));
  return ctx;
}

describe("PlaintextRenderer", () => {
  it("writes the person's message to status and the agent's messages to data", () => {
    const { data, status } = stream([
      user(R, "summarise"),
      ev(R, { case: "agentThinking", value: { id: `${R}.root.t0` } }),
      said(R, 0, "Reading."),
      said(R, 1, "Done."),
    ]);
    expect(data()).toBe("Reading.\nDone.\n");
    expect(status()).toBe("\n> summarise\n\n");
  });

  it("writes a line per tool state change, titled by a shell call's intent", () => {
    const { status } = stream([
      user(R, "go"),
      use(R, "c1", "shell", { input: { command: "npm test", description: "Run the tests" } }),
      result(R, "c1", "ok"),
      use(R, "c2", "fetch"),
      result(R, "c2", "connection refused", true),
      use(R, "c3", "read"),
      result(R, "c3", "", true),
    ]);
    expect(status()).toContain("  ⠋ Run the tests\n  ✓ Run the tests\n");
    expect(status()).toContain("  ⠋ fetch\n  ✗ fetch: connection refused\n");
    expect(status()).toContain("  ✗ read\n");
  });

  it("writes a waiting call, a denied one and one its ended turn cut short", () => {
    const { status } = stream([
      user(R, "go"),
      use(R, "c1", "delete", { permission: "ask" }),
      asked(R, "c1"),
      confirmed(R, "c1", "deny"),
      use(R, "c2", "write"),
      phase(R, "cancelled"),
    ]);
    expect(status()).toContain("  ⚠ Approval needed: delete\n  ⊘ delete (denied)\n");
    expect(status()).toContain("  ⠋ write\n  ⊘ write (interrupted)\n");
  });

  it("writes a subagent's start, its tool uses indented, and its end, without its messages", () => {
    const thread = `${R}.t1`;
    const { data, status } = stream([
      user(R, "go"),
      use(R, "t1", "task"),
      threadRunning(R, thread, "researcher"),
      use(R, "s1", "read", { threadId: thread }),
      said(R, 0, "working on it", thread),
      result(R, "s1", "contents", false, thread),
      threadIdle(R, thread, "end_turn"),
      result(R, "t1", "found it"),
    ]);
    expect(status()).toContain("  ⠋ task\n  ↳ Subagent: researcher\n    ⠋ read\n    ✓ read\n  ✓ Subagent completed: researcher\n  ✓ task\n");
    expect(data()).toBe("");
  });

  it("names a subagent by its call when it has no name, and writes how it failed or stopped", () => {
    const failed = `${R}.t1`;
    const stopped = `${R}.t2`;
    const { status } = stream([
      user(R, "go"),
      use(R, "t1", "task"),
      threadIdle(R, failed, "retries_exhausted"),
      use(R, "t2", "task"),
      threadRunning(R, stopped, "writer"),
      phase(R, "terminated"),
    ]);
    expect(status()).toContain("  ↳ Subagent: task\n  ✗ Subagent failed: task\n");
    expect(status()).toContain("  ↳ Subagent: writer\n");
    expect(status()).toContain("  ⊘ Subagent stopped: writer\n");
  });

  it("writes notes, compactions and the turn's errors once each", () => {
    const { status } = stream([
      user(R, "go"),
      note(R, `${R}.root.n0`, "tools are off"),
      ev(R, { case: "agentThreadContextCompacted", value: { id: "cmp" } }),
      failure(R, "err1", "model overloaded"),
      phase(R, "failed"),
    ]);
    expect(status()).toBe("\n> go\n\n[system] tools are off\n  … Context compacted\n  ✗ model overloaded\n");
  });

  it("writes a background command's line each time its state changes, from its own status", () => {
    const { status } = stream([
      user(R, "go"),
      phase(R, "running"),
      use(R, "bg1", "execute", { input: { command: "npm test", background: true } }),
      result(R, "bg1", "Started in the background (id bg1)."),
      background(R, "bg1"),
      use(R, "bg2", "execute", { input: { command: "npm run dev", background: true } }),
      result(R, "bg2", "Started in the background (id bg2)."),
      background(R, "bg2"),
      background(R, "bg1", { ending: "exited", exitCode: 1 }),
      background(R, "bg2", { ending: "stopped", stoppedBy: "person" }),
    ]);
    expect(status()).toContain("    Background command `npm test` is running\n");
    expect(status()).toContain("    Background command `npm test` exited with code 1\n");
    expect(status()).toContain("    Background command `npm run dev` was stopped by the person\n");
    expect(status()).not.toContain("[system]");
    expect(status().match(/Background command `npm test` exited/g)).toHaveLength(1);
  });

  it("does not walk a turn the fold left untouched", () => {
    const ctx = renderer();
    const fold = foldSession([user(R, "go"), said(R, 0, "Hi.")]);
    ctx.r.event();
    ctx.r.fold(fold);
    ctx.r.fold(fold);
    expect(ctx.data()).toBe("Hi.\n");
    expect(ctx.status()).toBe("\n> go\n\n");
  });

  it("says how each ask was answered, and why", () => {
    const ask = {} as ToolUse;
    const ctx = renderer();
    ctx.r.answering(ask, "", answerFor(""));
    ctx.r.answering(ask, "allow-all", answerFor("allow-all"));
    expect(ctx.status()).toBe(
      "    → denied (no --approve-default)\n    → allowed for the rest of the turn (--approve-default allow-all)\n",
    );
  });
});
