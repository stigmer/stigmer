/**
 * The hooks guide's program draws every part of a conversation and answers
 * through the conversation's own methods, against a client double: a turn
 * with to-dos draws each item with the steps made under it; a helper shows
 * what it was asked and its reply; thinking starts closed; an ask is
 * answered with Allow; a call of the app's own tool is answered Done
 * (`isError` false) or Can't (`isError` true) and leaves the list once the
 * answer is in the log; a changed file is kept by its digest; and a file a
 * turn made is listed once its turn ends (the files list re-read on the
 * runs' key) and opened through a short-lived link. Every query is by role
 * and accessible name, so the test also holds the program's names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { Stigmer } from "@stigmer/client";
import { samples } from "../../../src/test/samples";
import { sessionEventStream, type SessionEventStream } from "../../../src/session/__tests__/session-event-stream";
import { Chat } from "../Chat";

const RUN = "run_1";
const SESSION = "session-1";

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

function stored(event: EventInit): SessionEvent {
  return create(SessionEventSchema, { sessionId: SESSION, runId: RUN, event });
}

function run(phase: RunPhase): Run {
  return samples.run({ id: RUN, phase, sessionId: SESSION });
}

/** A tool call and its result. */
function call(name: string, input: Record<string, unknown>, result: string, id = `${RUN}.tc-${name}`): SessionEvent[] {
  const use = samples.toolUseEvent(name, input as never, { runId: RUN, id });
  return [use, samples.toolResultEvent(id, result, { runId: RUN })];
}

let events: SessionEventStream;
let runs: Run[];
let files: StigmerFile[];
const methods = {
  confirmToolUse: vi.fn(),
  answerCustomToolUse: vi.fn(),
  reviewFileChanges: vi.fn(),
  listAll: vi.fn(),
  getDownloadUrl: vi.fn(),
};

function client(): Stigmer {
  return {
    session: {
      get: vi.fn().mockResolvedValue(create(SessionSchema, { metadata: { id: SESSION, org: "acme" } })),
      streamEvents: events.streamEvents,
      confirmToolUse: methods.confirmToolUse,
      answerCustomToolUse: methods.answerCustomToolUse,
      reviewFileChanges: methods.reviewFileChanges,
    },
    run: {
      listBySession: vi.fn(async () => ({ entries: runs, nextPageToken: "" })),
      get: vi.fn(async () => runs[0]),
    },
    file: { listAll: methods.listAll, getDownloadUrl: methods.getDownloadUrl },
    identityAccount: { whoAmI: vi.fn().mockRejectedValue(new Error("no account")) },
  } as unknown as Stigmer;
}

function open(): void {
  render(<Chat client={client()} org="acme" agent="acme/billing" sessionId={SESSION} />);
}

beforeEach(() => {
  runs = [run(RunPhase.RUN_IN_PROGRESS)];
  files = [];
  for (const method of Object.values(methods)) method.mockReset();
  methods.confirmToolUse.mockResolvedValue({});
  methods.answerCustomToolUse.mockResolvedValue({});
  methods.reviewFileChanges.mockResolvedValue({});
  methods.listAll.mockImplementation(async function* () {
    yield* files;
  });
  methods.getDownloadUrl.mockResolvedValue({ url: "https://files.example/audit.md" });
});

afterEach(cleanup);

describe("the hooks guide's chat", () => {
  it("draws each to-do with the steps made under it, then a helper with its reply", async () => {
    const taskId = `${RUN}.tc-task`;
    events = sessionEventStream([
      samples.userMessageEvent("Fix the rounding.", { runId: RUN }),
      samples.runStatusEvent("running", { runId: RUN }),
      ...call("write_todos", { todos: [{ content: "Find the rounding", status: "in_progress" }, { content: "Fix it", status: "pending" }] }, "Updated", `${RUN}.tc-todos-1`),
      ...call("read_file", { path: "src/billing/invoice.ts" }, "export function invoiceTotal() {}"),
      ...call("write_todos", { todos: [{ content: "Find the rounding", status: "completed" }, { content: "Fix it", status: "in_progress" }] }, "Updated", `${RUN}.tc-todos-2`),
      samples.toolUseEvent("task", { description: "map where credit notes round" }, { runId: RUN, id: taskId }),
      stored({ case: "sessionThreadCreated", value: { id: `${taskId}.created`, sessionThreadId: taskId, agentName: "researcher" } }),
      stored({ case: "agentThreadMessageSent", value: { id: `${taskId}.sent`, toSessionThreadId: taskId, content: [{ type: "text", text: "Find where credit notes round" }] } }),
      stored({ case: "agentThreadMessageReceived", value: { id: `${taskId}.received`, fromSessionThreadId: taskId, content: [{ type: "text", text: "Per line, in lineTotal." }] } }),
      stored({ case: "sessionThreadStatusIdle", value: { id: `${taskId}.idle`, sessionThreadId: taskId, stopReason: { type: "end_turn" } } }),
    ]);
    open();

    const plan = await screen.findByRole("list", { name: "Plan" });
    const [find, fix] = within(plan).getAllByRole("listitem").filter((item) => item.parentElement === plan);
    expect(find?.textContent).toContain("Find the rounding · done");
    expect(find?.textContent).toContain("Read invoice.ts");
    expect(fix?.textContent).toContain("Fix it · working");
    const helper = within(fix!).getByRole("group", { name: "Helper: researcher" });
    expect(helper?.textContent).toContain("researcher, asked: Find where credit notes round");
    expect(helper?.textContent).toContain("Per line, in lineTotal.");
  });

  it("draws thinking closed", async () => {
    events = sessionEventStream([
      samples.userMessageEvent("Fix the rounding.", { runId: RUN }),
      samples.runStatusEvent("running", { runId: RUN }),
      ...samples.thinkingEvents("Rounding per line loses a cent.", { runId: RUN }),
    ]);
    open();

    const summary = await screen.findByText("Thinking");
    expect(summary.closest("details")?.open).toBe(false);
  });

  it("answers an ask with Allow", async () => {
    const use = samples.toolUseEvent("execute", { command: "npm test" }, { runId: RUN, evaluatedPermission: "ask" });
    events = sessionEventStream([
      samples.userMessageEvent("Run the tests.", { runId: RUN }),
      samples.runStatusEvent("running", { runId: RUN }),
      use,
      samples.permissionAskedEvent(use.event.value!.id, { runId: RUN }),
      samples.runStatusEvent("waiting", { runId: RUN }),
    ]);
    open();

    const ask = await screen.findByRole("group", { name: "The agent asks first" });
    expect(ask?.textContent).toContain("npm test");
    fireEvent.click(within(ask).getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(methods.confirmToolUse).toHaveBeenCalledWith(expect.objectContaining({ toolUseId: use.event.value!.id, result: "allow" })));
  });

  it("answers a call of the app's own tool Done, and it leaves once answered", async () => {
    const use = samples.customToolUseEvent("show_page", { path: "/settings/billing" }, { runId: RUN });
    events = sessionEventStream([
      samples.userMessageEvent("Show me billing.", { runId: RUN }),
      samples.runStatusEvent("running", { runId: RUN }),
      use,
      samples.runStatusEvent("waiting", { runId: RUN }),
    ]);
    open();

    const asked = await screen.findByRole("group", { name: "The agent asks your app: Show page" });
    expect(asked?.textContent).toContain("/settings/billing");
    expect(screen.getByText(/Show page · waiting for the app/)).toBeTruthy();
    fireEvent.click(within(asked).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(methods.answerCustomToolUse).toHaveBeenCalledWith(expect.objectContaining({ customToolUseId: use.event.value!.id, isError: false })),
    );

    act(() => events.push(samples.customToolResultEvent(use.event.value!.id, "Done.", { runId: RUN }), samples.runStatusEvent("running", { runId: RUN })));
    await waitFor(() => expect(screen.queryByRole("group", { name: "The agent asks your app: Show page" })).toBeNull());
  });

  it("answers a call of the app's own tool Can't, as an error", async () => {
    const use = samples.customToolUseEvent("show_page", { path: "/settings/billing" }, { runId: RUN });
    events = sessionEventStream([samples.userMessageEvent("Show me billing.", { runId: RUN }), samples.runStatusEvent("running", { runId: RUN }), use, samples.runStatusEvent("waiting", { runId: RUN })]);
    open();

    fireEvent.click(within(await screen.findByRole("group", { name: "The agent asks your app: Show page" })).getByRole("button", { name: "Can't" }));
    await waitFor(() => expect(methods.answerCustomToolUse).toHaveBeenCalledWith(expect.objectContaining({ isError: true })));
  });

  it("keeps a changed file by its digest", async () => {
    runs = [run(RunPhase.RUN_COMPLETED)];
    events = sessionEventStream([
      ...samples.turnEvents({ runId: RUN, message: "Fix the rounding.", tools: [{ name: "edit_file", input: { path: "src/a.ts" }, result: "1 edit applied" }], phase: "running", reply: "" }),
      stored({
        case: "stigmerFileReviewChanges",
        value: {
          id: "cs-1.changes",
          changeSetId: "cs-1",
          aggregateDigest: "agg",
          files: [{ fileChangeId: "f1", path: "src/a.ts", change: "modified", digest: "d1", linesAdded: 3, linesRemoved: 1, reviewable: "complete" }],
        },
      }),
      samples.runStatusEvent("completed", { runId: RUN }),
    ]);
    open();

    const changed = await screen.findByRole("list", { name: "Files changed" });
    expect(changed?.textContent).toContain("src/a.ts · +3 −1");
    fireEvent.click(within(changed).getByRole("button", { name: "Keep src/a.ts" }));
    await waitFor(() =>
      expect(methods.reviewFileChanges).toHaveBeenCalledWith(expect.objectContaining({ changeSetId: "cs-1", fileChangeId: "f1", action: "keep", expectedDigest: "d1" })),
    );
  });

  it("lists a file the turn made once the turn ends, and opens it", async () => {
    const opened = vi.spyOn(window, "open").mockReturnValue(null);
    events = sessionEventStream([samples.userMessageEvent("Write the audit.", { runId: RUN }), samples.runStatusEvent("running", { runId: RUN })]);
    open();
    await waitFor(() => expect(methods.listAll).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("list", { name: "Files made" })).toBeNull();

    files = [samples.outputFile("audit.md", { runId: RUN })];
    runs = [run(RunPhase.RUN_COMPLETED)];
    act(() => events.push(samples.agentMessageEvent("The audit is written.", { runId: RUN }), samples.runStatusEvent("completed", { runId: RUN })));

    const made = await screen.findByRole("list", { name: "Files made" });
    fireEvent.click(within(made).getByRole("button", { name: "audit.md" }));
    await waitFor(() => expect(opened).toHaveBeenCalledWith("https://files.example/audit.md", "_blank", "noopener"));
    expect(methods.getDownloadUrl).toHaveBeenCalledWith(files[0]!.metadata!.id);
    opened.mockRestore();
  });
});
