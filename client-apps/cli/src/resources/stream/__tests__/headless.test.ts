// Tests for the headless stream driver over a session's event log: every
// stored event reaches the renderer and the fold after it; the drive ends
// with the followed turn's phase, error and folded turn once that turn ends
// (another turn's end does not end it); asks are answered once each, with
// the run's --approve-default answer, only when the session idles waiting on
// them; a refusal because the call no longer waits is settled, any other
// failure ends the drive with a message naming how to re-attach; a dropped
// stream is classified; an abort exits cleanly; the follow is aborted on
// every way out. A finished session's events replay through the renderer.

import { Code, ConnectError } from "@connectrpc/connect";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { StreamSessionEventsResponse } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { eventTypeOf, type SessionFold, type ToolUse } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import { asked, frameOf, idle, phase, said, use, user } from "../../__test-utils__/session-events.js";
import { type ApproveDefault, type AskAnswer, DENY_REASON } from "../answer.js";
import { type HeadlessRenderer, type HeadlessStreamDeps, renderReplay, runHeadlessStream } from "../headless.js";

const R = "run_a";

class RecordingRenderer implements HeadlessRenderer {
  readonly types: string[] = [];
  readonly folds: SessionFold[] = [];
  readonly answered: Array<{ id: string; choice: ApproveDefault; answer: AskAnswer }> = [];
  event(event: SessionEvent): void {
    this.types.push(eventTypeOf(event));
  }
  fold(fold: SessionFold): void {
    this.folds.push(fold);
  }
  answering(ask: ToolUse, choice: ApproveDefault, answer: AskAnswer): void {
    this.answered.push({ id: ask.id, choice, answer });
  }
}

function source(events: SessionEvent[]): (signal: AbortSignal) => AsyncIterable<StreamSessionEventsResponse> {
  return async function* (signal: AbortSignal) {
    for (const event of events) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      yield frameOf(event);
    }
  };
}

// A source that yields `events`, then waits until its signal aborts.
function held(events: SessionEvent[], seen: { signal?: AbortSignal }) {
  return async function* (signal: AbortSignal) {
    seen.signal = signal;
    for (const event of events) yield frameOf(event);
    await new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }),
    );
  };
}

function deps(overrides: Partial<HeadlessStreamDeps>): HeadlessStreamDeps {
  return {
    follow: source([]),
    answer: async () => {},
    approveDefault: "",
    renderer: new RecordingRenderer(),
    sessionId: "ses_1",
    runId: R,
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** A turn that waits on two asks. */
function waitingTurn(): SessionEvent[] {
  return [
    user(R, "clean up"),
    phase(R, "running"),
    use(R, "c1", "shell", { permission: "ask" }),
    asked(R, "c1"),
    use(R, "c2", "delete", { permission: "ask" }),
    asked(R, "c2"),
    idle("requires_action", [`${R}.c1`, `${R}.c2`]),
  ];
}

describe("runHeadlessStream", () => {
  it("renders every event and the fold after it, and ends with the turn's phase", async () => {
    const renderer = new RecordingRenderer();
    const result = await runHeadlessStream(
      deps({
        follow: source([user(R, "hi"), phase(R, "running"), said(R, 0, "Hello."), phase(R, "completed"), said(R, 1, "late")]),
        renderer,
      }),
    );
    expect(result.phase).toBe("completed");
    expect(result.error).toBe("");
    expect(result.turn?.answer).toBe("Hello.");
    expect(renderer.types).toEqual(["user.message", "stigmer.run.status", "agent.message", "stigmer.run.status"]);
    expect(renderer.folds).toHaveLength(4);
  });

  it("carries a failed turn's error", async () => {
    const result = await runHeadlessStream(deps({ follow: source([user(R, "hi"), phase(R, "failed", "model refused")]) }));
    expect([result.phase, result.error]).toEqual(["failed", "model refused"]);
  });

  it("follows past another turn's end until its own turn ends", async () => {
    const renderer = new RecordingRenderer();
    const result = await runHeadlessStream(
      deps({
        follow: source([user("run_0", "before"), phase("run_0", "completed"), user(R, "now"), phase(R, "completed")]),
        renderer,
      }),
    );
    expect(result.turn?.runId).toBe(R);
    expect(renderer.types).toHaveLength(4);
  });

  it("answers each ask the session waits on once, with the --approve-default answer", async () => {
    const renderer = new RecordingRenderer();
    const answers: Array<[string, AskAnswer]> = [];
    const result = await runHeadlessStream(
      deps({
        follow: source([...waitingTurn(), user("run_x", "unrelated"), phase(R, "completed")]),
        answer: async (id, answer) => void answers.push([id, answer]),
        approveDefault: "allow",
        renderer,
      }),
    );
    expect(answers).toEqual([
      [`${R}.c1`, { kind: "allow" }],
      [`${R}.c2`, { kind: "allow" }],
    ]);
    expect(renderer.answered.map((a) => [a.id, a.choice])).toEqual([
      [`${R}.c1`, "allow"],
      [`${R}.c2`, "allow"],
    ]);
    expect(result.phase).toBe("completed");
  });

  it("answers only the asks an idle names, each once across idles", async () => {
    const answers: string[] = [];
    await runHeadlessStream(
      deps({
        follow: source([
          ...waitingTurn().slice(0, 6),
          idle("requires_action", [`${R}.c1`]),
          idle("requires_action", [`${R}.c1`, `${R}.c2`]),
          phase(R, "completed"),
        ]),
        answer: async (id) => void answers.push(id),
      }),
    );
    expect(answers).toEqual([`${R}.c1`, `${R}.c2`]);
  });

  it("answers nothing before the session idles waiting on the ask", async () => {
    const answers: string[] = [];
    await runHeadlessStream(
      deps({
        follow: source([user(R, "go"), use(R, "c1", "shell", { permission: "ask" }), asked(R, "c1"), phase(R, "cancelled")]),
        answer: async (id) => void answers.push(id),
      }),
    );
    expect(answers).toEqual([]);
  });

  it("denies with the neutral reason when --approve-default is unset", async () => {
    const answers: AskAnswer[] = [];
    await runHeadlessStream(
      deps({ follow: source([...waitingTurn().slice(0, 4), idle("requires_action", [`${R}.c1`]), phase(R, "completed")]), answer: async (_id, answer) => void answers.push(answer) }),
    );
    expect(answers).toEqual([{ kind: "deny", reason: DENY_REASON }]);
  });

  it("settles a refusal whose call no longer waits and answers the rest", async () => {
    const answers: string[] = [];
    const result = await runHeadlessStream(
      deps({
        follow: source([...waitingTurn(), phase(R, "completed")]),
        approveDefault: "allow-all",
        answer: async (id) => {
          answers.push(id);
          if (id === `${R}.c2`) throw new ConnectError(`tool use ${id} was already answered otherwise`, Code.FailedPrecondition);
        },
      }),
    );
    expect(answers).toEqual([`${R}.c1`, `${R}.c2`]);
    expect([result.phase, result.error]).toEqual(["completed", ""]);
  });

  it("ends with a re-attach message when an answer fails for good", async () => {
    const result = await runHeadlessStream(
      deps({
        follow: source(waitingTurn()),
        sessionId: "ses_9",
        answer: async () => {
          throw new ConnectError("nope", Code.PermissionDenied);
        },
      }),
    );
    expect(result.phase).toBe("");
    expect(result.error).toContain("Failed to answer the shell call");
    expect(result.error).toContain("stigmer resume ses_9");
    expect(result.turn?.runId).toBe(R);
  });

  it("names no resume when the run has no session", async () => {
    const result = await runHeadlessStream(
      deps({
        follow: source(waitingTurn()),
        sessionId: "",
        answer: async () => {
          throw new ConnectError("refused", Code.PermissionDenied);
        },
      }),
    );
    expect(result.error).toBe("Failed to answer the shell call: [permission_denied] refused");
  });

  it("returns empty when aborted while answering", async () => {
    const controller = new AbortController();
    const result = await runHeadlessStream(
      deps({
        follow: source(waitingTurn()),
        signal: controller.signal,
        answer: async () => {
          controller.abort();
          throw new ConnectError("cancelled", Code.Canceled);
        },
      }),
    );
    expect(result).toEqual({ phase: "", error: "", turn: undefined });
  });

  it("classifies a dropped stream with a resume hint", async () => {
    const result = await runHeadlessStream(
      deps({
        follow: async function* () {
          yield frameOf(user(R, "hi"));
          throw new ConnectError("gone", Code.Unavailable);
        },
      }),
    );
    expect(result.error).toContain("Connection to server lost.");
    expect(result.error).toContain("stigmer resume ses_1");
  });

  it("returns empty when the follow ends before the turn does", async () => {
    const result = await runHeadlessStream(deps({ follow: source([user(R, "hi"), phase(R, "running")]) }));
    expect(result).toEqual({ phase: "", error: "", turn: undefined });
  });

  it("skips a frame that changes nothing", async () => {
    const event = user(R, "hi");
    const renderer = new RecordingRenderer();
    await runHeadlessStream(deps({ follow: source([event, event]), renderer }));
    expect(renderer.types).toHaveLength(2);
    expect(renderer.folds).toHaveLength(1);
  });

  it("aborts the follow once the turn has ended", async () => {
    const seen: { signal?: AbortSignal } = {};
    const result = await runHeadlessStream(deps({ follow: held([user(R, "hi"), phase(R, "completed")], seen) }));
    expect(result.phase).toBe("completed");
    expect(seen.signal?.aborted).toBe(true);
  });

  it("passes the caller's abort through to the follow and exits cleanly", async () => {
    const controller = new AbortController();
    const seen: { signal?: AbortSignal } = {};
    const running = runHeadlessStream(deps({ follow: held([user(R, "hi")], seen), signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen.signal?.aborted).toBe(false);
    controller.abort();
    expect(await running).toEqual({ phase: "", error: "", turn: undefined });
    expect(seen.signal?.aborted).toBe(true);
  });
});

describe("renderReplay", () => {
  it("hands each stored event to the renderer, then the fold of them all", () => {
    const renderer = new RecordingRenderer();
    renderReplay([user(R, "hi"), said(R, 0, "Hello."), phase(R, "completed")], renderer);
    expect(renderer.types).toEqual(["user.message", "agent.message", "stigmer.run.status"]);
    expect(renderer.folds).toHaveLength(1);
    expect(renderer.folds[0]?.turns[0]?.answer).toBe("Hello.");
  });
});
