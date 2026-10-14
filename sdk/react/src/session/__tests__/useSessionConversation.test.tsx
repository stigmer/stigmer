/**
 * Proves useSessionConversation reads a conversation from the session's
 * event log and answers through the session's own methods: turns come from
 * the folded events (superseded and reconcile turns left out), runs from the
 * run list with the live turn's run read again and merged in; a send's
 * optimistic state hands over to its turn when the turn's events arrive; the
 * run list is read again only when another client's turn appears or a live
 * turn ends; asks are answered with confirmToolUse / grantPermission; the
 * newest turn's undecided file reviews are offered and decided with
 * reviewFileChanges; a stop interrupts the session, then terminates the run
 * on a repeat press; the follow's state is passed through; and a local
 * session keeps its runner worker attached while open.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileChangeSetSchema,
  FileChangeProgressSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema, type Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { Stigmer, TurnPhase } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { ExecutionTargetContext } from "../../execution-target-context";
import { RunnerAdapterContext } from "../../runner-adapter";
import type { RunnerAdapter } from "../../runner-adapter";
import { samples } from "../../test/samples";
import { useSessionConversation } from "../useSessionConversation";
import { sessionEventStream, type SessionEventStream } from "./session-event-stream";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSession(org = ""): Session {
  return create(SessionSchema, { metadata: { id: "session-1", org } });
}

function makeRun(
  id: string,
  phase: RunPhase,
  opts?: { supersedes?: string; reconcile?: boolean; changeSetId?: string; progress?: boolean },
): Run {
  const run = samples.run({ id, phase, sessionId: "session-1" });
  run.spec!.supersedesRunId = opts?.supersedes ?? "";
  run.spec!.reconcileFileReview = opts?.reconcile ?? false;
  if (opts?.changeSetId) {
    run.status!.fileChangeSets = [create(FileChangeSetSchema, { id: opts.changeSetId })];
  }
  if (opts?.progress) {
    run.status!.fileChangeProgress = create(FileChangeProgressSchema, {});
  }
  return run;
}

/** A turn's opening events: its message and the phase it is in. */
function turnOpen(runId: string, phase: TurnPhase, message = `message of ${runId}`): SessionEvent[] {
  return [
    samples.userMessageEvent(message, { runId }),
    samples.runStatusEvent(phase, { runId }),
  ];
}

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

function stored(runId: string, event: EventInit): SessionEvent {
  return create(SessionEventSchema, { sessionId: "session-1", runId, event });
}

/** A turn's captured changes (`stigmer.file_review.changes`), one file. */
function fileReviewChanges(runId: string, changeSetId: string): SessionEvent {
  return stored(runId, {
    case: "stigmerFileReviewChanges",
    value: {
      id: `${changeSetId}.changes`,
      changeSetId,
      aggregateDigest: `${changeSetId}-digest`,
      files: [
        {
          fileChangeId: `${changeSetId}-f1`,
          path: "src/a.ts",
          change: "modified",
          digest: "d1",
          reviewable: "complete",
        },
      ],
    },
  });
}

/** A whole-set keep of a change set (`stigmer.file_review.decided`). */
function keptAll(runId: string, changeSetId: string): SessionEvent {
  return stored(runId, {
    case: "stigmerFileReviewDecided",
    value: {
      id: `${changeSetId}.keep`,
      changeSetId,
      scope: "change_set",
      action: "keep",
      expectedDigest: `${changeSetId}-digest`,
      origin: "person",
    },
  });
}

/** A tool use of a run that waits for a person, and its ask. */
function waitingCall(runId: string, name: string): SessionEvent[] {
  const use = samples.toolUseEvent(name, { command: "ls" }, { runId, evaluatedPermission: "ask" });
  return [use, samples.permissionAskedEvent(use.event.value!.id, { runId })];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

interface Methods {
  sessionGet: ReturnType<typeof vi.fn>;
  listBySession: ReturnType<typeof vi.fn>;
  runGet: ReturnType<typeof vi.fn>;
  runCreate: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  confirmToolUse: ReturnType<typeof vi.fn>;
  grantPermission: ReturnType<typeof vi.fn>;
  interrupt: ReturnType<typeof vi.fn>;
  reviewFileChanges: ReturnType<typeof vi.fn>;
}

let methods: Methods;
let events: SessionEventStream;
// One client per test, as the provider gives: a new object per render would
// re-open the follow on every render.
let stigmerClient: Stigmer;

function client(): Stigmer {
  return {
    session: {
      get: methods.sessionGet,
      streamEvents: events.streamEvents,
      confirmToolUse: methods.confirmToolUse,
      grantPermission: methods.grantPermission,
      interrupt: methods.interrupt,
      reviewFileChanges: methods.reviewFileChanges,
    },
    run: {
      listBySession: methods.listBySession,
      get: methods.runGet,
      create: methods.runCreate,
      terminate: methods.terminate,
    },
    // The local-worker attach asks who is signed in; answer as a
    // single-user server does (no account).
    identityAccount: {
      whoAmI: vi.fn().mockRejectedValue(new Error("Identity account not found for the authenticated user")),
    },
  } as unknown as Stigmer;
}

function wrapper({ children }: { children: ReactNode }) {
  return <StigmerContext.Provider value={stigmerClient}>{children}</StigmerContext.Provider>;
}

/** Lists `runs`, and answers `run.get` with the listed run of that id. */
function listing(...runs: Run[]): void {
  methods.listBySession.mockResolvedValue({ entries: runs, nextPageToken: "" });
  methods.runGet.mockImplementation((id: string) => {
    const run = runs.find((r) => r.metadata?.id === id);
    return run ? Promise.resolve(run) : Promise.reject(new ConnectError("no run", Code.NotFound));
  });
}

function open(sessionId: string | null = "session-1", org = "org") {
  return renderHook(() => useSessionConversation(sessionId, org), { wrapper });
}

beforeEach(() => {
  events = sessionEventStream();
  methods = {
    sessionGet: vi.fn().mockResolvedValue(makeSession()),
    listBySession: vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" }),
    runGet: vi.fn().mockRejectedValue(new ConnectError("no run", Code.NotFound)),
    runCreate: vi.fn(),
    terminate: vi.fn().mockResolvedValue(makeRun("run_live", RunPhase.RUN_TERMINATED)),
    confirmToolUse: vi.fn().mockResolvedValue({}),
    grantPermission: vi.fn().mockResolvedValue({}),
    interrupt: vi.fn().mockResolvedValue({ stoppedRunIds: [] }),
    reviewFileChanges: vi.fn().mockResolvedValue({}),
  };
  stigmerClient = client();
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

describe("useSessionConversation — loading", () => {
  it("is idle for no session: nothing is read or followed", () => {
    const { result } = open(null);
    expect(result.current.session).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.canSendFollowUp).toBe(true);
    expect(result.current.turns).toEqual([]);
    expect(methods.sessionGet).not.toHaveBeenCalled();
    expect(methods.listBySession).not.toHaveBeenCalled();
    expect(events.streamEvents).not.toHaveBeenCalled();
  });

  it("loads while the session and its runs load", () => {
    methods.sessionGet.mockReturnValue(new Promise(() => {}));
    methods.listBySession.mockReturnValue(new Promise(() => {}));
    expect(open().result.current.isLoading).toBe(true);
  });

  it("a session with runs loads until its first events are folded", async () => {
    listing(makeRun("run_a", RunPhase.RUN_COMPLETED));
    const { result } = open();
    await waitFor(() => expect(methods.listBySession).toHaveBeenCalled());
    await waitFor(() => expect(result.current.session).not.toBeNull());
    expect(result.current.isLoading).toBe(true);

    act(() => events.push(...samples.turnEvents({ runId: "run_a" })));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.turns.map((turn) => turn.runId)).toEqual(["run_a"]);
  });

  it("a session with no runs has no events to wait for", async () => {
    const { result } = open();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.turns).toEqual([]);
    expect(result.current.activePhase).toBeNull();
  });

  it("surfaces a session read failure as loadError", async () => {
    methods.sessionGet.mockRejectedValue(new Error("session not found"));
    const { result } = open();
    await waitFor(() => expect(result.current.loadError?.message).toBe("session not found"));
  });

  it("files turns under the session's organization once it has loaded (#1580)", async () => {
    methods.sessionGet.mockReturnValue(new Promise(() => {}));
    expect(open("session-1", "personal").result.current.org).toBe("personal");
  });
});

// ---------------------------------------------------------------------------
// Turns and runs
// ---------------------------------------------------------------------------

describe("useSessionConversation — turns and runs", () => {
  it("reads turns from the events and runs from the list", async () => {
    const first = makeRun("run_a", RunPhase.RUN_COMPLETED);
    const second = makeRun("run_b", RunPhase.RUN_COMPLETED);
    listing(first, second);
    events.push(...samples.turnEvents({ runId: "run_a" }), ...samples.turnEvents({ runId: "run_b" }));

    const { result } = open();
    await waitFor(() => expect(result.current.turns).toHaveLength(2));
    expect(result.current.runs).toEqual([first, second]);
    expect(result.current.activeTurn).toBeNull();
    expect(result.current.activeRun).toBeNull();
    expect(result.current.canSendFollowUp).toBe(true);
  });

  it("a live turn is the active one: its run is read again and merged into the runs", async () => {
    const listed = makeRun("run_live", RunPhase.RUN_PENDING);
    const fresh = makeRun("run_live", RunPhase.RUN_IN_PROGRESS, { progress: true });
    methods.listBySession.mockResolvedValue({ entries: [listed], nextPageToken: "" });
    methods.runGet.mockResolvedValue(fresh);
    events.push(...turnOpen("run_live", "running"));

    const { result } = open();
    await waitFor(() => expect(result.current.activeRun).toBe(fresh));
    expect(result.current.activeTurn?.runId).toBe("run_live");
    expect(result.current.activePhase).toBe("running");
    expect(result.current.canSendFollowUp).toBe(false);
    expect(result.current.runs).toEqual([fresh]);
    expect(result.current.fileChangeProgress).toBe(fresh.status?.fileChangeProgress);
  });

  it("a live turn with no status yet reads as pending", async () => {
    listing(makeRun("run_live", RunPhase.RUN_PENDING));
    events.push(samples.userMessageEvent("hi", { runId: "run_live" }));
    const { result } = open();
    await waitFor(() => expect(result.current.activeTurn?.runId).toBe("run_live"));
    expect(result.current.activePhase).toBe("pending");
  });

  it("re-reads the live run when its turn changes phase", async () => {
    listing(makeRun("run_live", RunPhase.RUN_IN_PROGRESS));
    events.push(...turnOpen("run_live", "running"));
    const { result } = open();
    await waitFor(() => expect(result.current.activeRun).not.toBeNull());
    const reads = methods.runGet.mock.calls.length;

    act(() => events.push(samples.runStatusEvent("waiting", { runId: "run_live" })));
    await waitFor(() => expect(result.current.activePhase).toBe("waiting"));
    await waitFor(() => expect(methods.runGet.mock.calls.length).toBe(reads + 1));
  });

  it("hides superseded turns and runs, every link of a chain, and ignores a dangling link", async () => {
    listing(
      makeRun("run_a", RunPhase.RUN_CANCELLED),
      makeRun("run_b", RunPhase.RUN_CANCELLED, { supersedes: "run_a" }),
      makeRun("run_c", RunPhase.RUN_COMPLETED, { supersedes: "run_b" }),
      makeRun("run_d", RunPhase.RUN_COMPLETED, { supersedes: "run_gone" }),
    );
    for (const runId of ["run_a", "run_b", "run_c", "run_d"]) events.push(...samples.turnEvents({ runId }));

    const { result } = open();
    await waitFor(() => expect(result.current.turns.map((t) => t.runId)).toEqual(["run_c", "run_d"]));
    expect(result.current.runs.map((r) => r.metadata?.id)).toEqual(["run_c", "run_d"]);
  });

  it("hides the turn a live run supersedes before the list carries the live run", async () => {
    const live = makeRun("run_b", RunPhase.RUN_IN_PROGRESS, { supersedes: "run_a" });
    methods.listBySession.mockResolvedValue({ entries: [makeRun("run_a", RunPhase.RUN_CANCELLED)], nextPageToken: "" });
    methods.runGet.mockResolvedValue(live);
    events.push(...samples.turnEvents({ runId: "run_a", phase: "cancelled" }), ...turnOpen("run_b", "running"));

    const { result } = open();
    await waitFor(() => expect(result.current.turns.map((t) => t.runId)).toEqual(["run_b"]));
    // The live run is not listed yet: it joins the runs from its own read.
    expect(result.current.runs).toEqual([live]);
  });

  it("leaves reconcile turns out: listed ones, and an unlisted one with no message and no items", async () => {
    listing(
      makeRun("run_a", RunPhase.RUN_COMPLETED),
      makeRun("run_b", RunPhase.RUN_COMPLETED, { reconcile: true }),
    );
    events.push(
      ...samples.turnEvents({ runId: "run_a" }),
      samples.runStatusEvent("completed", { runId: "run_b" }),
      samples.runStatusEvent("running", { runId: "run_c" }),
    );

    const { result } = open();
    await waitFor(() => expect(result.current.turns.map((t) => t.runId)).toEqual(["run_a"]));
    expect(result.current.runs.map((r) => r.metadata?.id)).toEqual(["run_a"]);
    // A reconcile turn at work never holds the composer.
    expect(result.current.activeTurn).toBeNull();
    expect(result.current.canSendFollowUp).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Reading the run list again
// ---------------------------------------------------------------------------

describe("useSessionConversation — reading the run list again", () => {
  it("does not read the list again on open, for a finished or a live session", async () => {
    listing(makeRun("run_a", RunPhase.RUN_COMPLETED), makeRun("run_b", RunPhase.RUN_IN_PROGRESS));
    events.push(...samples.turnEvents({ runId: "run_a" }), ...turnOpen("run_b", "running"));
    const { result } = open();
    await waitFor(() => expect(result.current.activeRun).not.toBeNull());
    expect(methods.listBySession).toHaveBeenCalledTimes(1);
  });

  it("reads it once when a live turn ends", async () => {
    listing(makeRun("run_a", RunPhase.RUN_IN_PROGRESS));
    events.push(...turnOpen("run_a", "running"));
    const { result } = open();
    await waitFor(() => expect(result.current.activeTurn).not.toBeNull());
    expect(methods.listBySession).toHaveBeenCalledTimes(1);

    act(() => events.push(samples.runStatusEvent("completed", { runId: "run_a" })));
    await waitFor(() => expect(result.current.activeTurn).toBeNull());
    await waitFor(() => expect(methods.listBySession).toHaveBeenCalledTimes(2));
  });

  it("reads it once when another client's turn appears", async () => {
    listing(makeRun("run_a", RunPhase.RUN_COMPLETED));
    events.push(...samples.turnEvents({ runId: "run_a" }));
    const { result } = open();
    await waitFor(() => expect(result.current.turns).toHaveLength(1));
    expect(methods.listBySession).toHaveBeenCalledTimes(1);

    act(() => events.push(...turnOpen("run_b", "pending")));
    await waitFor(() => expect(methods.listBySession).toHaveBeenCalledTimes(2));
    act(() => events.push(samples.agentMessageEvent("still going", { runId: "run_b" })));
    await waitFor(() => expect(result.current.turns.at(-1)?.items).toHaveLength(1));
    expect(methods.listBySession).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

describe("useSessionConversation — sending", () => {
  async function opened() {
    const rendered = open();
    await waitFor(() => expect(rendered.result.current.session).not.toBeNull());
    await waitFor(() => expect(rendered.result.current.isLoading).toBe(false));
    return rendered;
  }

  it("shows the message and its files at once, holds the composer, and hands over when the turn arrives", async () => {
    methods.runCreate.mockResolvedValue(makeRun("run_new", RunPhase.RUN_PENDING));
    const attachments = [
      { filename: "sketch.png", storageKey: "attachments/01AAA/sketch.png", contentType: "image/png" },
    ];
    const { result } = await opened();

    await act(async () => {
      await result.current.sendFollowUp("Here is a sketch", { attachments });
    });
    expect(methods.runCreate).toHaveBeenCalledWith(
      expect.objectContaining({ org: "org", sessionId: "session-1", message: "Here is a sketch" }),
    );
    expect(result.current.pendingUserMessage).toBe("Here is a sketch");
    expect(result.current.pendingAttachments).toBe(attachments);
    expect(result.current.canSendFollowUp).toBe(false);
    expect(result.current.activePhase).toBe("pending");
    expect(result.current.isStoppable).toBe(false);
    const listReads = methods.listBySession.mock.calls.length;

    act(() => events.push(...turnOpen("run_new", "pending", "Here is a sketch")));
    await waitFor(() => expect(result.current.pendingUserMessage).toBeNull());
    expect(result.current.pendingAttachments).toBeNull();
    expect(result.current.activeTurn?.runId).toBe("run_new");
    // The send read the list itself; the turn's arrival does not again.
    expect(methods.listBySession).toHaveBeenCalledTimes(listReads);
  });

  it("files the turn under the session's organization (#1580)", async () => {
    methods.sessionGet.mockResolvedValue(makeSession("acme"));
    methods.runCreate.mockResolvedValue(makeRun("run_new", RunPhase.RUN_PENDING));
    const rendered = open("session-1", "personal");
    await waitFor(() => expect(rendered.result.current.org).toBe("acme"));
    await act(async () => {
      await rendered.result.current.sendFollowUp("Deploy it");
    });
    expect(methods.runCreate).toHaveBeenCalledWith(expect.objectContaining({ org: "acme" }));
  });

  it("forwards supersedesRunId", async () => {
    methods.runCreate.mockResolvedValue(makeRun("run_new", RunPhase.RUN_PENDING));
    const { result } = await opened();
    await act(async () => {
      await result.current.sendFollowUp("edited", { supersedesRunId: "run_old" });
    });
    expect(methods.runCreate).toHaveBeenCalledWith(expect.objectContaining({ supersedesRunId: "run_old" }));
  });

  it("shows no optimistic message for a build-from-plan send, but does when it fails", async () => {
    methods.runCreate.mockResolvedValueOnce(makeRun("run_new", RunPhase.RUN_PENDING));
    methods.runCreate.mockRejectedValueOnce(new Error("create boom"));
    const { result } = await opened();

    await act(async () => {
      await result.current.sendFollowUp("Build from plan", { buildFromPlan: true });
    });
    expect(result.current.pendingUserMessage).toBeNull();

    act(() => events.push(...turnOpen("run_new", "completed", "Build from plan")));
    await waitFor(() => expect(result.current.canSendFollowUp).toBe(true));
    await act(async () => {
      await result.current.sendFollowUp("Build from plan", { buildFromPlan: true });
    });
    expect(result.current.sendError?.message).toBe("create boom");
    expect(result.current.pendingUserMessage).toBe("Build from plan");
  });

  it("keeps the message and files when the send fails, and Retry resends them", async () => {
    methods.runCreate.mockRejectedValueOnce(new Error("create boom"));
    methods.runCreate.mockResolvedValue(makeRun("run_retry", RunPhase.RUN_PENDING));
    const attachments = [
      { filename: "notes.txt", storageKey: "attachments/01BBB/notes.txt", contentType: "text/plain" },
    ];
    const { result } = await opened();

    await act(async () => {
      await result.current.sendFollowUp("keep me", { attachments });
    });
    expect(result.current.sendError?.message).toBe("create boom");
    expect(result.current.pendingUserMessage).toBe("keep me");
    expect(result.current.pendingAttachments).toBe(attachments);

    act(() => result.current.clearSendError());
    expect(result.current.sendError).toBeNull();

    await act(async () => {
      result.current.retryLastSend();
    });
    await waitFor(() => expect(methods.runCreate).toHaveBeenCalledTimes(2));
    expect(methods.runCreate).toHaveBeenLastCalledWith(expect.objectContaining({ message: "keep me" }));
  });

  it("does nothing without a loaded session, and retry does nothing before a send", async () => {
    methods.sessionGet.mockReturnValue(new Promise(() => {}));
    const { result } = open();
    await act(async () => {
      await result.current.sendFollowUp("too early");
      result.current.retryLastSend();
    });
    expect(methods.runCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Asks
// ---------------------------------------------------------------------------

describe("useSessionConversation — asks", () => {
  async function waiting() {
    listing(makeRun("run_live", RunPhase.RUN_WAITING_FOR_APPROVAL));
    events.push(...turnOpen("run_live", "waiting"), ...waitingCall("run_live", "shell"));
    const rendered = open();
    await waitFor(() => expect(rendered.result.current.asks).toHaveLength(1));
    return rendered;
  }

  it("lists the live turn's waiting tool uses and allows one", async () => {
    const { result } = await waiting();
    const ask = result.current.asks[0]!;
    expect(ask.state).toBe("waiting");

    await act(async () => {
      await result.current.answerToolUse(ask.id, "allow");
    });
    expect(methods.confirmToolUse).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", toolUseId: ask.id, result: "allow", denyMessage: "" }),
    );
  });

  it("denies with a message, and grants a class through grantPermission", async () => {
    const { result } = await waiting();
    const ask = result.current.asks[0]!;

    await act(async () => {
      await result.current.answerToolUse(ask.id, "deny", "use staging");
    });
    expect(methods.confirmToolUse).toHaveBeenCalledWith(
      expect.objectContaining({ toolUseId: ask.id, result: "deny", denyMessage: "use staging" }),
    );

    await act(async () => {
      await result.current.answerToolUse(ask.id, "grant");
    });
    expect(methods.grantPermission).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-1", toolUseId: ask.id }),
    );
  });

  it("keeps a failed answer per tool use and as the scalar, until cleared", async () => {
    methods.confirmToolUse.mockRejectedValue(new Error("already answered"));
    const { result } = await waiting();
    const ask = result.current.asks[0]!;

    await act(async () => {
      await expect(result.current.answerToolUse(ask.id, "allow")).rejects.toThrow("already answered");
    });
    expect(result.current.answerErrors.get(ask.id)?.message).toBe("already answered");
    expect(result.current.answerError?.message).toBe("already answered");

    act(() => result.current.clearAnswerError());
    expect(result.current.answerErrors.size).toBe(0);
    expect(result.current.answerError).toBeNull();
  });

  it("answers nothing without a session", async () => {
    const { result } = open(null);
    await act(async () => {
      await result.current.answerToolUse("t1", "allow");
      await result.current.reviewFileChanges("cs1", "keep", { expectedDigest: "d" });
      await result.current.stop();
    });
    expect(methods.confirmToolUse).not.toHaveBeenCalled();
    expect(methods.reviewFileChanges).not.toHaveBeenCalled();
    expect(methods.interrupt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// File review
// ---------------------------------------------------------------------------

describe("useSessionConversation — file review", () => {
  it("offers the newest turn's undecided sets after it ended, with the runs' captures", async () => {
    listing(
      makeRun("run_a", RunPhase.RUN_COMPLETED, { changeSetId: "cs_a" }),
      makeRun("run_b", RunPhase.RUN_COMPLETED, { changeSetId: "cs_b" }),
    );
    events.push(
      ...samples.turnEvents({ runId: "run_a" }),
      fileReviewChanges("run_a", "cs_a"),
      ...samples.turnEvents({ runId: "run_b" }),
      fileReviewChanges("run_b", "cs_b"),
      fileReviewChanges("run_b", "cs_b2"),
      keptAll("run_b", "cs_b2"),
    );

    const { result } = open();
    await waitFor(() => expect(result.current.fileReviewSets.map((s) => s.changeSetId)).toEqual(["cs_b"]));
    expect([...result.current.fileChangeCaptures.keys()]).toEqual(["cs_a", "cs_b"]);
  });

  it("offers every set while all are undecided, and skips a reconcile turn after them", async () => {
    listing(
      makeRun("run_a", RunPhase.RUN_COMPLETED),
      makeRun("run_b", RunPhase.RUN_COMPLETED, { reconcile: true }),
    );
    events.push(
      ...samples.turnEvents({ runId: "run_a" }),
      fileReviewChanges("run_a", "cs_1"),
      fileReviewChanges("run_a", "cs_2"),
      samples.runStatusEvent("completed", { runId: "run_b" }),
    );
    const { result } = open();
    await waitFor(() => expect(result.current.fileReviewSets).toHaveLength(2));
  });

  it("decides through reviewFileChanges and keeps a failure per decision", async () => {
    listing(makeRun("run_a", RunPhase.RUN_COMPLETED));
    events.push(...samples.turnEvents({ runId: "run_a" }), fileReviewChanges("run_a", "cs_a"));
    const { result } = open();
    await waitFor(() => expect(result.current.fileReviewSets).toHaveLength(1));

    await act(async () => {
      await result.current.reviewFileChanges("cs_a", "undo", { fileChangeId: "cs_a-f1", expectedDigest: "d1" });
    });
    expect(methods.reviewFileChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        changeSetId: "cs_a",
        scope: "file",
        fileChangeId: "cs_a-f1",
        action: "undo",
        expectedDigest: "d1",
      }),
    );

    methods.reviewFileChanges.mockRejectedValueOnce(new Error("digest moved"));
    await act(async () => {
      await expect(
        result.current.reviewFileChanges("cs_a", "keep", { expectedDigest: "cs_a-digest" }),
      ).rejects.toThrow("digest moved");
    });
    expect(result.current.fileDecisionErrors.get("cs_a")?.message).toBe("digest moved");
    expect(result.current.fileReviewError?.message).toBe("digest moved");
    act(() => result.current.clearFileDecisionError("cs_a"));
    expect(result.current.fileDecisionErrors.has("cs_a")).toBe(false);
    act(() => result.current.clearFileReviewError());
    expect(result.current.fileReviewError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Stopping
// ---------------------------------------------------------------------------

describe("useSessionConversation — stopping", () => {
  it.each<TurnPhase>(["pending", "running", "waiting", "paused"])(
    "a %s turn can be stopped",
    async (phase) => {
      listing(makeRun("run_live", RunPhase.RUN_IN_PROGRESS));
      events.push(...turnOpen("run_live", phase));
      const { result } = open();
      await waitFor(() => expect(result.current.isStoppable).toBe(true));
    },
  );

  it("an ended turn cannot be stopped, and stop does nothing", async () => {
    listing(makeRun("run_a", RunPhase.RUN_COMPLETED));
    events.push(...samples.turnEvents({ runId: "run_a" }));
    const { result } = open();
    await waitFor(() => expect(result.current.turns).toHaveLength(1));
    expect(result.current.isStoppable).toBe(false);
    await act(async () => {
      await result.current.stop();
    });
    expect(methods.interrupt).not.toHaveBeenCalled();
  });

  it("interrupts the session, then terminates the run on a repeat press", async () => {
    listing(makeRun("run_live", RunPhase.RUN_IN_PROGRESS));
    events.push(...turnOpen("run_live", "running"));
    let release!: () => void;
    methods.interrupt.mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve({ stoppedRunIds: ["run_live"] });
      }),
    );
    const { result } = open();
    await waitFor(() => expect(result.current.isStoppable).toBe(true));

    let first!: Promise<void>;
    act(() => {
      first = result.current.stop("user stop");
    });
    expect(result.current.isStopping).toBe(true);
    await act(async () => {
      release();
      await first;
    });
    expect(methods.interrupt).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1" }));
    expect(result.current.isStopping).toBe(false);

    await act(async () => {
      await result.current.stop("still going");
    });
    expect(methods.interrupt).toHaveBeenCalledTimes(1);
    expect(methods.terminate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "run_live", reason: "still going" }),
    );
  });

  it("surfaces a failed interrupt and interrupts again on the next press", async () => {
    listing(makeRun("run_live", RunPhase.RUN_IN_PROGRESS));
    events.push(...turnOpen("run_live", "running"));
    methods.interrupt.mockRejectedValueOnce(new Error("engine down"));
    const { result } = open();
    await waitFor(() => expect(result.current.isStoppable).toBe(true));

    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.stopError?.message).toBe("engine down");

    await act(async () => {
      await result.current.stop();
    });
    expect(methods.interrupt).toHaveBeenCalledTimes(2);
    expect(methods.terminate).not.toHaveBeenCalled();
    expect(result.current.stopError).toBeNull();
  });

  it("surfaces a failed terminate", async () => {
    listing(makeRun("run_live", RunPhase.RUN_IN_PROGRESS));
    events.push(...turnOpen("run_live", "running"));
    methods.terminate.mockRejectedValue(new Error("no terminate"));
    const { result } = open();
    await waitFor(() => expect(result.current.isStoppable).toBe(true));

    await act(async () => {
      await result.current.stop();
    });
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.stopError?.message).toBe("no terminate");
  });
});

// ---------------------------------------------------------------------------
// The follow
// ---------------------------------------------------------------------------

describe("useSessionConversation — the follow", () => {
  it("passes a refused follow through as streamError, and reconnects on request", async () => {
    let refuse = true;
    events.streamEvents.mockImplementation(async function* refusing() {
      if (refuse) throw new ConnectError("gone", Code.NotFound);
      yield* [];
    });
    const { result } = open();
    await waitFor(() => expect(result.current.streamError).not.toBeNull());
    expect(result.current.isReconnecting).toBe(false);
    expect(result.current.connectTimedOut).toBe(false);
    expect(result.current.isSlow).toBe(false);

    refuse = false;
    act(() => result.current.reconnectStream());
    await waitFor(() => expect(events.streamEvents).toHaveBeenCalledTimes(2));
  });

  it("reports the follow as streaming once events arrive", async () => {
    listing(makeRun("run_a", RunPhase.RUN_COMPLETED));
    events.push(...samples.turnEvents({ runId: "run_a" }));
    const { result } = open();
    expect(result.current.isConnecting).toBe(true);
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// Local runner worker
// ---------------------------------------------------------------------------

describe("useSessionConversation — local runner worker lifecycle", () => {
  function createMockAdapter(): RunnerAdapter & {
    onSessionOpened: ReturnType<typeof vi.fn>;
    onSessionClosed: ReturnType<typeof vi.fn>;
  } {
    return {
      onSessionOpened: vi.fn().mockResolvedValue(undefined),
      onSessionClosed: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("attaches the worker once when a local session opens and detaches on close", async () => {
    const adapter = createMockAdapter();
    const localClient = stigmerClient;
    const { unmount } = renderHook(() => useSessionConversation("session-1", "org"), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ExecutionTargetContext.Provider value="local">
          <RunnerAdapterContext.Provider value={adapter}>
            <StigmerContext.Provider value={localClient}>{children}</StigmerContext.Provider>
          </RunnerAdapterContext.Provider>
        </ExecutionTargetContext.Provider>
      ),
    });

    await waitFor(() => expect(adapter.onSessionOpened).toHaveBeenCalledWith("session-1"));
    expect(adapter.onSessionOpened).toHaveBeenCalledTimes(1);
    expect(adapter.onSessionClosed).not.toHaveBeenCalled();

    unmount();
    expect(adapter.onSessionClosed).toHaveBeenCalledTimes(1);
    expect(adapter.onSessionClosed).toHaveBeenCalledWith("session-1");
  });
});
