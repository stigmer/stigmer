// The session view's scenes: the real `SessionViewer`, as the console and an
// embedding product draw it, over a state of the scenario catalogue, for
// each person who looks at it: the builder at work in the console (with the
// inspector), the end user inside a customer's product (the conversation
// alone), a chat link's guest, and a reviewer reading a conversation they
// cannot take part in.
//
// The viewer loads the conversation itself, so a scene answers the calls it
// makes from a replay (a catalogue scenario, or a session a story scene
// builds from the kit's samples): the session, its event log, then a follow that
// replays the events, sends the liveness preview the scenario holds, and
// stays open as a live stream does; its runs, the Files its turns
// returned and, for one opened, its first bytes. Beside them it answers what the console's viewer reads around
// the conversation, as for its owner: the person and their organization,
// permission to act in the session, the session's agent, no scores, no My
// vault yet, and a server that predates the server-info fields (the panel
// asks). A guest skips the organization reads; the router answers only
// what is asked. A scene that draws more than one conversation (two
// customers' panels side by side) names the others, and each call is then
// answered from the session it asks for, by its id, with every session's
// organization in the person's list.
import { Code, ConnectError, type ConnectRouter, type HandlerContext } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import { ScoreQueryController } from "@stigmer/apis/ai/stigmer/agentic/score/v1/query_pb";
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
import { SessionInspector, SessionViewer, type SessionAudience } from "@stigmer/react-sdk";
import { samples, scenarios, type Scenario, type ScenarioName } from "@stigmer/react-sdk/test";
import { ACCOUNT } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";

/** The organization the scenarios' session lives in, as the person's organization list names it. */
const SESSION_ORG = samples.organization({ id: samples.session().metadata!.org, slug: samples.session().metadata!.org });

/** What a returned File holds when the inspector opens it: the audit the finished turn wrote. */
const AUDIT_REPORT = new TextEncoder().encode(
  "# Invoice rounding audit\n\nFourteen invoices were a cent off. Each rounded every line before the total.\n\n| Invoice | Billed | Correct |\n| --- | --- | --- |\n| INV-1042 | 118.07 | 118.06 |\n| INV-1057 | 64.31 | 64.30 |\n",
);

/** What the scenes replay to the viewer: the parts of a scenario its calls read. */
export type SessionReplay = Pick<Scenario, "session" | "events" | "runs" | "files" | "liveness" | "loadError">;

/** How the host frames the viewer: who looks, and whether it passes the builder's inspector. */
export interface Framing {
  readonly audience?: SessionAudience;
  /** The console's framing: the inspector beside the conversation. */
  readonly inspector?: boolean;
}

/**
 * The follow: every event after the client's place, the scenario's liveness
 * preview, then open until the viewer leaves. The client's call settles on
 * the first frame, so a scenario with no events would hold the scene
 * unsettled; none drawn here has none.
 */
async function* follow(scenario: SessionReplay, request: StreamSessionEventsRequest, context: HandlerContext) {
  const after = request.afterSeq ?? 0n;
  for (const event of scenario.events) if (event.seq > after) yield samples.eventFrame(event);
  if (scenario.liveness !== undefined) {
    yield create(StreamSessionEventsResponseSchema, { frame: { case: "stigmerRunLiveness", value: scenario.liveness } });
  }
  await new Promise((resolve) => context.signal.addEventListener("abort", resolve));
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
}

/** The calls the viewer makes for `scenario`, answered as for the session's owner. */
export function sessionRoutes(scenario: SessionReplay, { agent = samples.agent(), others = [] }: Answering = {}) {
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
        return follow(loadable(replay, replay), request, context);
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
    router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: true }) });
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

/** The session view over `replay`, framed as given. */
export function sessionDrawing(replay: SessionReplay, framing: Framing = {}): Drawing {
  const session = replay.session ?? samples.session();
  return {
    inOrganization: true,
    routes: sessionRoutes(replay),
    render: () => (
      <div style={{ height: "calc(100vh - 48px)" }}>
        <SessionViewer
          sessionId={session.metadata!.id}
          org={session.metadata!.org}
          audience={framing.audience}
          inspector={framing.inspector ? <SessionInspector /> : undefined}
        />
      </div>
    ),
  };
}
