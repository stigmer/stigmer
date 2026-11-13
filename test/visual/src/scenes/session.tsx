// The session view's scenes: the real `SessionViewer`, as the console and an
// embedding product draw it, over a state of the scenario catalogue, for
// each person who looks at it: the builder at work in the console (with the
// inspector), the end user inside a customer's product (the conversation
// alone), a chat link's guest, a reviewer reading a conversation they
// cannot take part in, and a teammate who sends messages but leaves
// approvals and file decisions to the conversation's owner.
//
// The viewer loads the conversation itself, so a scene answers the calls it
// makes from a replay (a catalogue scenario, or a session a story scene
// builds from the kit's samples): the session, its event log, then a follow that
// replays the events, opens the thoughts the scenario has begun, sends the
// liveness preview it holds, and stays open as a live stream does; its runs, the Files its turns
// returned and, for one opened, its first bytes. Beside them it answers what the console's viewer reads around
// the conversation, as for its owner: the person and their organization,
// permission to act in the session (a teammate's framing refuses the
// owner's `can_edit`), the session's agent, no scores, no My
// vault yet, and a server that predates the server-info fields (the panel
// asks). A guest skips the organization reads; the router answers only
// what is asked. A scene that draws more than one conversation (two
// customers' panels side by side) names the others, and each call is then
// answered from the session it asks for, by its id, with every session's
// organization in the person's list.
import { Code, ConnectError, type ConnectRouter, type HandlerContext } from "@connectrpc/connect";
import { clone, create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { FileChangeKind, InteractionMode, RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { FileChangeProgressSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import { ScoreQueryController } from "@stigmer/apis/ai/stigmer/agentic/score/v1/query_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/status_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  StreamSessionEventsResponseSchema,
  type StreamSessionEventsRequest,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { ApiResourceAuditSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";
import { SessionInspector, SessionViewer, type SessionAudience } from "@stigmer/react-sdk";
import {
  endingStories,
  sampleInstant,
  samples,
  scenarios,
  stepStories,
  type EndingStoryName,
  type Scenario,
  type ScenarioName,
  type StepStoryName,
} from "@stigmer/react-sdk/test";
import { ACCOUNT } from "../fixtures.ts";
import { LiveConversation } from "../live-server.ts";
import type { Drawing } from "./drawing.ts";

/** The organization the scenarios' session lives in, as the person's organization list names it. */
const SESSION_ORG = samples.organization({ id: samples.session().metadata!.org, slug: samples.session().metadata!.org });

/** What a returned File holds when the inspector opens it: the audit the finished turn wrote. */
const AUDIT_REPORT = new TextEncoder().encode(
  "# Invoice rounding audit\n\nFourteen invoices were a cent off. Each rounded every line before the total.\n\n| Invoice | Billed | Correct |\n| --- | --- | --- |\n| INV-1042 | 118.07 | 118.06 |\n| INV-1057 | 64.31 | 64.30 |\n",
);

/** What the scenes replay to the viewer: the parts of a scenario its calls read. */
export type SessionReplay = Pick<Scenario, "session" | "events" | "runs" | "files" | "liveness" | "loadError" | "outputs" | "drafts">;

/** How the host frames the viewer: who looks, and whether it passes the builder's inspector. */
export interface Framing {
  readonly audience?: SessionAudience;
  /** The console's framing: the inspector beside the conversation. */
  readonly inspector?: boolean;
  /**
   * Who looks, beyond the audience: a teammate (`participant`) may send
   * messages but not stop the turn, approve its calls or decide its file
   * edits, which are the owner's (`can_edit`). The owner by default.
   */
  readonly role?: "participant";
  /**
   * How tall the view is drawn, in pixels; the viewport's height by
   * default. A scene that opens steps is drawn tall enough to hold the whole
   * turn, so its thread never scrolls: a click on a row in a scrolling
   * thread races the thread's own pinning to its newest content.
   */
  readonly height?: number;
}

/**
 * A conversation that grows while the viewer follows it: the docs' scripted
 * server (src/live-server.ts) appends to it as a reader sends, approves and
 * stops.
 */
export interface LiveFeed {
  /** The events after log place `after`, once there are any; never resolves after `signal` aborts. */
  readonly after: (after: bigint, signal: AbortSignal) => Promise<readonly SessionEvent[]>;
}

/**
 * The follow: every event after the client's place, the thoughts the
 * scenario has begun, its liveness preview and what its running commands
 * printed so far, then open until the
 * viewer leaves; with a live feed, each event
 * the feed appends as it comes. The client's call settles on the first
 * frame, so a scenario with no events would hold the scene unsettled; none
 * drawn here has none.
 */
async function* follow(scenario: SessionReplay, request: StreamSessionEventsRequest, context: HandlerContext, live?: LiveFeed) {
  let after = request.afterSeq ?? 0n;
  for (const event of scenario.events) {
    if (event.seq <= after) continue;
    yield samples.eventFrame(event);
    after = event.seq;
  }
  for (const draft of scenario.drafts ?? []) yield samples.draftFrame(draft.id, draft.kind);
  if (scenario.liveness !== undefined) {
    yield create(StreamSessionEventsResponseSchema, { frame: { case: "stigmerRunLiveness", value: scenario.liveness } });
  }
  for (const output of scenario.outputs ?? []) yield samples.toolOutputDeltaFrame(output.toolUseId, output.delta);
  if (live === undefined) {
    await new Promise((resolve) => context.signal.addEventListener("abort", resolve));
    return;
  }
  while (!context.signal.aborted) {
    for (const event of await live.after(after, context.signal)) {
      yield samples.eventFrame(event);
      after = event.seq;
    }
  }
}

/** `answer`, or the refusal of a scenario whose session cannot load (the server is unreachable). */
function loadable<T>(scenario: SessionReplay, answer: T): T {
  if (scenario.loadError !== null) throw new ConnectError(scenario.loadError.message, Code.Unavailable);
  return answer;
}

/** Who answers the session: the samples' agent unless a scene names its own, and the other sessions a scene draws. */
export interface Answering {
  readonly agent?: Agent;
  /** Further conversations the scene draws beside `scenario`, each answered by its session's id. */
  readonly others?: readonly SessionReplay[];
  /** What the follow streams after `scenario`'s events, for a conversation the docs' scripted server grows. */
  readonly live?: LiveFeed;
  /** The relations the person is refused on the session (`can_edit` for a teammate); every other check is allowed. */
  readonly refused?: readonly string[];
}

/** The calls the viewer makes for `scenario`, answered as for the session's owner. */
export function sessionRoutes(scenario: SessionReplay, { agent = samples.agent(), others = [], live, refused = [] }: Answering = {}) {
  const replays = [scenario, ...others];
  // With one conversation every call is answered from it, whatever id it
  // names, as the scenes always have; with more, from the one it names.
  const replayOf = (sessionId: string): SessionReplay => {
    if (others.length === 0) return scenario;
    const replay = replays.find((candidate) => candidate.session?.metadata?.id === sessionId);
    if (replay === undefined) throw new ConnectError(`no session ${sessionId}`, Code.NotFound);
    return replay;
  };
  const organizations =
    others.length === 0
      ? [SESSION_ORG]
      : [...new Set(replays.map((replay) => replay.session?.metadata?.org ?? ""))].map((org) => samples.organization({ id: org, slug: org }));
  return (router: ConnectRouter) => {
    router.service(SessionQueryController, {
      get: (request) => {
        const replay = replayOf(request.value);
        return loadable(replay, replay.session!);
      },
      listEvents: (request) => {
        const replay = replayOf(request.sessionId);
        return loadable(replay, samples.sessionEventList(replay.events));
      },
      streamEvents: (request, context) => {
        const replay = replayOf(request.sessionId);
        return follow(loadable(replay, replay), request, context, replay === scenario ? live : undefined);
      },
    });
    router.service(RunQueryController, {
      listBySession: (request) => samples.runList([...replayOf(request.sessionId).runs]),
      get: (request) => {
        const run = replays.flatMap((replay) => replay.runs).find((candidate) => candidate.metadata?.id === request.value);
        if (run === undefined) throw new ConnectError(`no run ${request.value}`, Code.NotFound);
        return run;
      },
    });
    router.service(FileQueryController, {
      // A list by turn alone names no session: its Files are the turn's, wherever they live.
      list: (request) => ({
        entries:
          others.length > 0 && request.sessionId === ""
            ? replays.flatMap((replay) => replay.files).filter((file) => file.status?.runId === request.runId)
            : [...replayOf(request.sessionId).files],
      }),
      // A File opened in the inspector reads its first bytes.
      getContent: () => ({ data: AUDIT_REPORT, truncated: false }),
    });
    router.service(ScoreQueryController, { listBySession: () => ({ entries: [] }) });
    router.service(AgentQueryController, { getByReference: () => agent });
    router.service(OrganizationQueryController, { listMine: () => samples.organizationList(organizations) });
    router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
    router.service(GrantQueryController, { checkMyPermission: (request) => ({ isAuthorized: !refused.includes(request.relation) }) });
    router.service(PlatformQueryController, { getServerInfo: () => ({}) });
    router.service(RoutineQueryController, {
      get: (request) => create(RoutineSchema, { metadata: { id: request.value, name: "Nightly billing check", slug: "nightly-billing-check", org: SESSION_ORG.metadata!.id } }),
    });
    router.service(VaultQueryController, {
      getMine: () => {
        throw new ConnectError("no My vault yet", Code.NotFound);
      },
    });
  };
}

/** The session view over the `name` state, framed as given (an embed's by default: the conversation alone). */
export function sessionScene(name: ScenarioName, framing: Framing = {}): Drawing {
  return sessionDrawing(scenarios[name], framing);
}

/** The session view over the ending turn `name`, framed as given. */
export function endingStoryScene(name: EndingStoryName, framing: Framing = {}): Drawing {
  return sessionDrawing(endingStories[name], framing);
}

/** The session view over the step turn `name`, framed as given. */
export function stepStoryScene(name: StepStoryName, framing: Framing = {}): Drawing {
  return sessionDrawing(stepStories[name], framing);
}

/**
 * The session view before its session exists, as a host draws it while the
 * session is being made: no id yet, so it reads nothing and says it starts.
 */
export function sessionStartingScene(): Drawing {
  const drawing = sessionDrawing(scenarios.empty, { inspector: true });
  return {
    ...drawing,
    render: () => (
      <div style={{ height: "calc(100vh - 48px)" }}>
        <SessionViewer sessionId="" org={samples.session().metadata!.org} inspector={<SessionInspector />} />
      </div>
    ),
  };
}

/** The owner a teammate's framing names: the person who started the conversation. */
const OWNER_NAME = "Maya Okafor";

/**
 * The session view over the `busy` state while the turn's edits are still
 * being made: the run's status carries the live count of files changed so
 * far, which the view draws above the composer until the turn ends.
 */
export function sessionFileProgressScene(): Drawing {
  const busy = scenarios.busy;
  const entry = (path: string, linesAdded: number, linesRemoved: number) => ({
    pathBefore: path,
    pathAfter: path,
    kind: FileChangeKind.MODIFY,
    linesAdded,
    linesRemoved,
  });
  const runs = busy.runs.map((run) => {
    const changing = clone(RunSchema, run);
    if (changing.status !== undefined) {
      changing.status.fileChangeProgress = create(FileChangeProgressSchema, {
        changeSetId: `${run.metadata!.id}:1`,
        filesChanged: 2,
        linesAdded: 10,
        linesRemoved: 5,
        entries: [entry("src/billing/invoice.ts", 6, 3), entry("src/billing/credit-note.ts", 4, 2)],
        capturedAt: sampleInstant(60_000),
      });
    }
    return changing;
  });
  return sessionDrawing({ ...busy, runs }, { inspector: true });
}

/** The plan the Plan-mode turn wrote, as its last message and as the File it returned. */
const ROUNDING_PLAN = [
  "# Round invoices once, at the total",
  "",
  "1. Keep full precision in `lineTotal`; stop rounding each line.",
  "2. Round `invoiceTotal` half-even to the cent.",
  "3. Apply the same rule to credit notes.",
  "4. Add tests for the half-cent cases from last month's audit.",
].join("\n");

/**
 * The session view over a finished Plan-mode turn: the agent read the code,
 * wrote its plan, and returned it as a File, so the thread shows the plan's
 * card with Build, which implements it in a new turn.
 */
export function sessionPlanBuildScene(): Drawing {
  const message = "Plan how invoices should round. Don't change anything yet.";
  const events = samples
    .turnEvents({
      message,
      tools: [
        { name: "grep", input: { pattern: "round(", path: "src/billing" }, result: "src/billing/invoice.ts:41\nsrc/billing/credit-note.ts:18" },
        { name: "read_file", input: { path: "src/billing/invoice.ts" }, result: "export function lineTotal(line: Line): Cents {" },
      ],
      reply: ROUNDING_PLAN,
    })
    .map((event, index) => ({ ...event, seq: BigInt(index + 1) }));
  const run = samples.run({ phase: RunPhase.RUN_COMPLETED, message });
  run.spec!.interactionMode = InteractionMode.PLAN;
  const plan = samples.outputFile("round-invoices-once_3f9a1c.plan.md", { mimeType: "text/markdown", sizeBytes: 312n });
  return sessionDrawing(
    { session: samples.session({ subject: "Plan invoice rounding" }), events, runs: [run], files: [plan], liveness: undefined, loadError: null },
    { inspector: true },
  );
}

/** The session as a teammate reads it: started by someone else, whose name the view gives. */
function startedByOwner(session: SessionReplay["session"]): SessionReplay["session"] {
  if (session === null) return null;
  const theirs = clone(SessionSchema, session);
  theirs.status ??= create(SessionStatusSchema);
  theirs.status.audit = create(ApiResourceAuditSchema, { specAudit: { createdBy: { id: "acc_owner", displayName: OWNER_NAME } } });
  return theirs;
}

/** The session view over `replay`, framed as given. */
export function sessionDrawing(source: SessionReplay, framing: Framing = {}): Drawing {
  const participant = framing.role === "participant";
  const replay = participant ? { ...source, session: startedByOwner(source.session) } : source;
  const session = replay.session ?? samples.session();
  return {
    inOrganization: true,
    routes: sessionRoutes(replay, participant ? { refused: ["can_edit"] } : {}),
    liveRoutes: () => new LiveConversation(replay).routes(),
    render: () => (
      <div style={{ height: framing.height === undefined ? "calc(100vh - 48px)" : `${framing.height}px` }}>
        <SessionViewer
          sessionId={session.metadata!.id}
          org={session.metadata!.org}
          audience={framing.audience}
          inspector={framing.inspector ? <SessionInspector /> : undefined}
          agentHref={(agent) => `/library/agents/${agent.org}/${agent.slug}`}
        />
      </div>
    ),
  };
}
