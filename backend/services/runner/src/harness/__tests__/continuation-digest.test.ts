/**
 * Unit tests for the continuation digest (`../continuation-digest.ts`;
 * issue #366, stigmer#2417).
 *
 * The digest is the replacement agent's only account of the work its lost
 * predecessor did, so these pins cover the three doctrine properties it
 * inherits from the rollover context bridge's composer — bounded lines, drop-oldest
 * budget enforcement with disclosure, never-throw — plus the rendering
 * contract per item of the run's folded events, and the read that fetches
 * them only when asked and degrades when the log cannot be read.
 */

import { describe, it, expect, vi } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { composeTurnRecoveryDigest, formatContinuationText, formatTurnRecoveryText, readTurnRecoveryDigest } from "../continuation-digest.js";

const RUN = "run_recovery";
let seq = 0;

type EventValue = NonNullable<Parameters<typeof create<typeof SessionEventSchema>>[1]>["event"];

function ev(event: EventValue, runId = RUN): SessionEvent {
  return create(SessionEventSchema, { runId, event });
}

function message(text: string): SessionEvent {
  const id = `${RUN}.root.m${seq++}`;
  return ev({ case: "agentMessage", value: { id, content: [{ type: "text", text }] } });
}

function note(text: string): SessionEvent {
  const id = `${RUN}.root.n${seq++}`;
  return ev({ case: "stigmerHarnessNote", value: { id, text } });
}

/** A tool use, and what the log says about it after: an ask, an answer, a result. */
function tool(
  name: string,
  input: JsonObject = {},
  after: { ask?: { message?: string; argsPreview?: string }; answer?: "allow" | "deny"; result?: { text: string; isError: boolean } } = {},
): SessionEvent[] {
  const id = `${RUN}.call${seq++}`;
  const events = [ev({ case: "agentToolUse", value: { id, name, input, evaluatedPermission: after.ask ? "ask" : "" } })];
  if (after.ask) {
    events.push(ev({ case: "stigmerPermissionAsked", value: { id: `${id}.ask`, toolUseId: id, message: after.ask.message ?? "", argsPreview: after.ask.argsPreview ?? "" } }));
  }
  if (after.answer) events.push(ev({ case: "userToolConfirmation", value: { id: `sevt_tc_${id}`, toolUseId: id, result: after.answer } }));
  if (after.result) {
    events.push(ev({ case: "agentToolResult", value: { id: `${id}.r`, toolUseId: id, content: [{ type: "text", text: after.result.text }], isError: after.result.isError } }));
  }
  return events;
}

const done = { result: { text: "ok", isError: false } };

describe("composeTurnRecoveryDigest", () => {
  it("renders the agent's messages and tool uses oldest-first", () => {
    const digest = composeTurnRecoveryDigest(
      [message("Let me check the config first."), ...tool("Read", { path: "config.yaml" }, done), message("The port is wrong — fixing it.")],
      RUN,
    );
    expect(digest).toBe(
      [
        "Assistant: Let me check the config first.",
        'Tool: Read({"path":"config.yaml"}) — completed',
        "Assistant: The port is wrong — fixing it.",
      ].join("\n"),
    );
  });

  it("prefers the ask's message for a tool line — the same description the user approved against — then its preview", () => {
    const digest = composeTurnRecoveryDigest(
      [
        ...tool("Write", { path: "gated.txt", content: "..." }, { ask: { message: "Write file: gated.txt" }, answer: "allow" }),
        ...tool("Shell", { command: "make" }, { ask: { argsPreview: '{"command":"make"}' } }),
      ],
      RUN,
    );
    expect(digest).toBe(["Tool: Write file: gated.txt — paused for user approval", 'Tool: Shell({"command":"make"}) — paused for user approval'].join("\n"));
  });

  it("maps each outcome honestly and treats in-flight calls as interrupted", () => {
    const digest = composeTurnRecoveryDigest(
      [
        ...tool("A", {}, done),
        ...tool("B", {}, { result: { text: "exit 1", isError: true } }),
        ...tool("C", {}, { result: { text: "", isError: true } }),
        ...tool("D", {}, { ask: { message: "" }, answer: "deny" }),
        ...tool("E"),
      ],
      RUN,
    );
    expect(digest).toBe(
      [
        "Tool: A — completed",
        "Tool: B — failed: exit 1",
        "Tool: C — failed",
        "Tool: D — skipped",
        "Tool: E — interrupted before it finished",
      ].join("\n"),
    );
  });

  it("keeps the platform's notes but skips the person's message (already in <user_request>), thinking, blanks and other runs", () => {
    const thinkingId = `${RUN}.root.t${seq++}`;
    const digest = composeTurnRecoveryDigest(
      [
        ev({ case: "userMessage", value: { id: "sevt_user", content: [{ type: "text", text: "Fix the build" }] } }),
        note("Budget warning: 80% used"),
        ev({ case: "agentThinking", value: { id: thinkingId } }),
        ev({ case: "stigmerAgentThinking", value: { id: `${thinkingId}.text`, thinkingId, text: "hmm, maybe the lockfile" } }),
        message("   "),
        ev({ case: "agentMessage", value: { id: "run_other.root.m0", content: [{ type: "text", text: "another turn" }] } }, "run_other"),
      ],
      RUN,
    );
    expect(digest).toBe("System: Budget warning: 80% used");
  });

  it("returns undefined when nothing renders", () => {
    expect(composeTurnRecoveryDigest([], RUN)).toBeUndefined();
    expect(
      composeTurnRecoveryDigest([ev({ case: "userMessage", value: { id: "sevt_only", content: [{ type: "text", text: "only the request" }] } })], RUN),
    ).toBeUndefined();
  });

  it("truncates a long assistant line at the per-line budget with an ellipsis", () => {
    const digest = composeTurnRecoveryDigest([message("x".repeat(1000))], RUN);
    expect(digest).toBe(`Assistant: ${"x".repeat(400)}\u2026`);
  });

  it("drops the OLDEST lines when over the whole-digest budget and discloses the omission", () => {
    // 30 lines of ~311 chars each (~9.6k total) against the 4000-char budget:
    // the newest lines must survive, the oldest go, and the notice leads.
    const events = Array.from({ length: 30 }, (_, i) => message(`step ${String(i).padStart(2, "0")} ${"y".repeat(300)}`));
    const digest = composeTurnRecoveryDigest(events, RUN);
    expect(digest).toBeDefined();
    expect(digest!.length).toBeLessThanOrEqual(4000);
    const lines = digest!.split("\n");
    expect(lines[0]).toBe("[\u2026 earlier activity in this turn omitted for length]");
    // Recency wins: the last line is the newest entry, the first entries are gone.
    expect(lines[lines.length - 1]).toContain("step 29");
    expect(digest).not.toContain("step 00");
  });

  it("never throws — a malformed event degrades to no digest, not a failed recovery", () => {
    // Force the fold to blow up: an event whose case getter throws.
    const poison = new Proxy(message("ok"), {
      get(target, prop, receiver) {
        if (prop === "event") throw new Error("corrupt event");
        return Reflect.get(target, prop, receiver);
      },
    });
    expect(composeTurnRecoveryDigest([poison], RUN)).toBeUndefined();
  });
});

describe("readTurnRecoveryDigest", () => {
  it("reads the run's events once and composes them", async () => {
    const read = vi.fn(async () => [message("Read it.")]);
    expect(await readTurnRecoveryDigest(read, RUN)).toBe("Assistant: Read it.");
    expect(read).toHaveBeenCalledOnce();
  });

  it("degrades to no digest when the log cannot be read", async () => {
    expect(await readTurnRecoveryDigest(async () => Promise.reject(new Error("log unreachable")), RUN)).toBeUndefined();
  });
});

describe("formatTurnRecoveryText", () => {
  it("frames a digest with the work-already-done preamble", () => {
    const text = formatTurnRecoveryText("Assistant: did things");
    expect(text).toContain("session holding that conversation was lost");
    expect(text).toContain("do not start the task over");
    expect(text.endsWith("Assistant: did things")).toBe(true);
  });

  it("still discloses the state loss when there is no transcript — without it the appended decisions would read as reactions to proposals this agent never made", () => {
    for (const empty of [undefined, "", "   "]) {
      const text = formatTurnRecoveryText(empty);
      expect(text).toContain("session holding that conversation was lost");
      expect(text).toContain("no transcript of your progress is available");
    }
  });
});

describe("formatContinuationText", () => {
  it("tells an engine that holds its conversation to carry on, never handing it the task, and follows with the digest", () => {
    const text = formatContinuationText("Assistant: built it");
    expect(text).toContain("Continue the same task from where you were");
    expect(text).toContain("Do not start it over");
    expect(text).not.toContain("user_request");
    expect(text.endsWith("Assistant: built it")).toBe(true);
  });

  it("says the same with no transcript to show", () => {
    for (const empty of [undefined, "", "   "]) {
      const text = formatContinuationText(empty);
      expect(text).toContain("Continue the same task from where you were");
      expect(text).toContain("check the workspace's current state to see what you already did");
    }
  });
});
