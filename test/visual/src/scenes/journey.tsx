// The journey from a first agent to its users, as each surface draws it:
// the dashboard's six-step card for an organization part of the way along
// (an agent picked and a key in but nothing run yet; then run and changed,
// above the week's figures) and folded at six of six; the agent page's
// "Make it yours" tab for the agent the first question made, as an editor
// who may make skills sees it and as one who may not; the line under the
// agent's first finished job; and the launcher on that agent for a run on a
// file of the person's own, and with the journey's next step under its
// heading.
//
// The journey is read from the server as the kit reads it (`useJourney`):
// the organization's onboarding, one answer the scenes give from their
// state by the server's rule (an agent made; a key served or a job done; a
// job done; the journey's agent changed; an app user; a teammate), so the
// card and its lines draw exactly as against a server. The agent is the one the first question makes from the
// variance-report example (`@stigmer/examples`, read from the package's
// source): its name, slug, description, instructions and the tool it may
// not use, and nothing else. Six of six needs an app user and a teammate on
// the access list beside every earlier read, so the folded card is drawn
// from a journey passed to the card directly.
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { AgentSchema, type Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { ListAgentVersionsResponseSchema, type ListAgentVersionsResponse } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { ProviderAvailability, type GetModelReadinessOutput } from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import {
  OnboardingProgressSchema,
  OnboardingStepId,
  OnboardingStepSchema,
  type OnboardingProgress,
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/onboarding_pb";
import { isJourneyAgentSlug } from "../../../../examples/src/journey/index.ts";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import {
  AgentDetailView,
  DashboardFirstSteps,
  JourneyNextLine,
  NewSessionViewer,
  OperationalDashboard,
  PageHeader,
  SessionInspector,
  SessionViewer,
  exampleLaunch,
  type DashboardFirstStepLinks,
  type JourneyLinks,
  type JourneyStep,
  type MakeItYoursLinks,
  type UseJourneyReturn,
} from "@stigmer/react-sdk";
import { sampleDate, samples } from "@stigmer/react-sdk/test";
import { exampleById, type Example } from "../../../../examples/src/index.ts";
import { BUSY_WEEK_RUNS, BUSY_WEEK_USAGE, EMPTY_USAGE, NO_RUNS, ORGANIZATION } from "../fixtures.ts";
import { agentRoutes, MENU, START_SESSION } from "./agent.tsx";
import { ANTHROPIC_ONLY, launcherRoutes } from "./models.tsx";
import { SESSION_ORG, sessionRoutes, type SessionReplay } from "./session.tsx";
import { numbered } from "./story-data.ts";
import type { Drawing } from "./drawing.ts";

const ORG_ID = ORGANIZATION.metadata?.id ?? "";
const ORG_SLUG = ORGANIZATION.metadata?.slug ?? "";
const DAY_MS = 86_400_000;

function inert(): void {}

/** The variance-report example, as `@stigmer/examples` lists it. */
function varianceExample(): Example {
  const example = exampleById("variance-report");
  if (example === undefined) throw new Error("@stigmer/examples lists no variance-report");
  return example;
}

/** The agent the first question makes from the variance-report example, in `org`, made two days before the samples' instant. */
function journeyAgent(org: string = ORG_ID): Agent {
  const { agent } = varianceExample();
  const made = timestampFromDate(sampleDate(-2 * DAY_MS));
  return create(AgentSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { id: "agt_00000000000000000000000071", name: agent.name, slug: agent.slug, org, visibility: ApiResourceVisibility.visibility_org },
    spec: { description: agent.description, instructions: agent.instructions, disallowedTools: [...agent.disallowedTools] },
    status: { audit: { specAudit: { createdAt: made, updatedAt: made } } },
  });
}

/** The agent's history: the version the first question made, and, once changed, the newer one on top. */
function journeyVersions(changed: boolean): ListAgentVersionsResponse {
  const first = { versionHash: "a41c07d2", appliedAt: timestampFromDate(sampleDate(-2 * DAY_MS)), message: "First version" };
  return create(ListAgentVersionsResponseSchema, {
    entries: changed
      ? [{ versionHash: "c95e2b18", appliedAt: timestampFromDate(sampleDate(-DAY_MS)), isCurrent: true, message: "" }, first]
      : [{ ...first, isCurrent: true }],
  });
}

/** Where the journey's later steps lead in these scenes: the console's addresses, drawn as plain anchors. */
const JOURNEY_LINKS: JourneyLinks & MakeItYoursLinks = {
  makeItYours: (agent) => `/library/agents/${ORG_SLUG}/${agent.slug}?tab=make-it-yours`,
  putInApp: (agent) => `/library/agents/${ORG_SLUG}/${agent.slug}?tab=in-app`,
  bringOthers: "/settings/members",
  launch: ({ agent, example, mode }) => `/?agent=${ORG_SLUG}/${agent.slug}${example ? `&example=${example}` : ""}&with=${mode}`,
};

/** The dashboard's step links, as the console passes them. */
const STEP_LINKS: DashboardFirstStepLinks = {
  connectProvider: "/models",
  createAgent: "/",
  startSession: "/",
  makeItYours: JOURNEY_LINKS.makeItYours,
  putInApp: JOURNEY_LINKS.putInApp,
  bringOthers: JOURNEY_LINKS.bringOthers,
};

/** Where an organization is: what it has made, whether a key serves, whether anything ran, and whether its agent changed. */
export interface JourneyState {
  /** The agents the server lists, newest first. */
  readonly agents: readonly Agent[];
  readonly readiness: GetModelReadinessOutput;
  readonly ran: boolean;
  /** Whether the journey agent has a second version. */
  readonly changed: boolean;
  /** Whether the person may make skills (the agent page's skill card asks). */
  readonly makesSkills?: boolean;
}

/**
 * The organization reads a scene answers beside the journey's: its own
 * organization by default. The router answers a service from the last one
 * named, so a scene whose other routes name its organizations passes them
 * here.
 */
export interface OrganizationAnswers {
  readonly listMine?: () => ReturnType<typeof samples.organizationList>;
  readonly get?: () => typeof ORGANIZATION;
}

const THE_ORGANIZATION: OrganizationAnswers = { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION };

/** Where the people of an organization stand, for the journey's last two steps. */
export interface JourneyPeople {
  /** The first app user's name, or undefined when none signed in from the app. */
  readonly appUser?: string;
  /** The teammates besides the viewer, in the list's order. */
  readonly joined?: readonly string[];
}

/**
 * The organization's onboarding as the server answers it for an admin of an
 * organization in `state`, by the server's rule
 * (domain/onboarding/progress.ts): an agent is made; a provider serves or a
 * job is done; a job is done; the journey's agent changed; an app user
 * signed in; a teammate joined.
 */
export function journeyAnswer(state: JourneyState, people: JourneyPeople = {}): OnboardingProgress {
  const journeyAgents = state.agents.filter((agent) => isJourneyAgentSlug(agent.metadata?.slug ?? ""));
  const named = (agent: Agent | undefined) =>
    agent === undefined ? undefined : { org: agent.metadata?.org ?? ORG_ID, slug: agent.metadata?.slug ?? "", name: agent.metadata?.name ?? "" };
  const served = state.readiness.providers.find((report) =>
    [ProviderAvailability.served_by_organization, ProviderAvailability.served_by_parent_organization, ProviderAvailability.served_by_runners].includes(
      report.availability,
    ),
  )?.provider;
  const joined = people.joined ?? [];
  const done = new Set<OnboardingStepId>([
    ...(state.agents.length > 0 ? [OnboardingStepId.describe] : []),
    ...(served !== undefined || state.ran ? [OnboardingStepId.key] : []),
    ...(state.ran ? [OnboardingStepId.watch] : []),
    ...(state.changed && journeyAgents.length > 0 ? [OnboardingStepId.make_yours] : []),
    ...(people.appUser !== undefined ? [OnboardingStepId.in_app] : []),
    ...(joined.length > 0 ? [OnboardingStepId.others] : []),
  ]);
  const answer = create(OnboardingProgressSchema, {
    newestAgent: named(journeyAgents[0]),
    changedAgent: state.changed ? named(journeyAgents[0]) : undefined,
    servedProvider: served ?? "",
    everRan: state.ran,
    appUserName: people.appUser ?? "",
    joinedNames: joined.slice(0, 2),
    joinedCount: joined.length,
  });
  answer.steps = [
    OnboardingStepId.describe,
    OnboardingStepId.key,
    OnboardingStepId.watch,
    OnboardingStepId.make_yours,
    OnboardingStepId.in_app,
    OnboardingStepId.others,
  ].map((id) => create(OnboardingStepSchema, { id, done: done.has(id) }));
  return answer;
}

/**
 * The calls `useJourney` and the pages around it make, answered for an
 * admin of an organization in `state`. A service named here replaces every method an earlier route gave
 * it (connect's router answers each method from the last service named), so
 * each one carries every method the scenes that compose it call.
 */
export function journeyRoutes(state: JourneyState, organizations: OrganizationAnswers = THE_ORGANIZATION) {
  return (router: ConnectRouter) => {
    router.service(GrantQueryController, {
      checkMyPermission: (input) => ({ isAuthorized: input.relation !== "can_create_skill" || state.makesSkills !== false }),
    });
    router.service(PlatformQueryController, { getModelReadiness: () => state.readiness, getServerInfo: () => ({}) });
    router.service(OrganizationQueryController, { ...organizations, getOnboarding: () => journeyAnswer(state) });
    router.service(AgentQueryController, {
      list: () => ({ entries: [...state.agents], nextPageToken: "" }),
      listVersions: () => journeyVersions(state.changed),
      getByReference: (input) => {
        const agent = state.agents.find((candidate) => candidate.metadata?.slug === input.slug);
        if (agent === undefined) throw new ConnectError(`no agent ${input.slug}`, Code.NotFound);
        return agent;
      },
      get: () => {
        const agent = state.agents[0];
        if (agent === undefined) throw new ConnectError("no agent", Code.NotFound);
        return agent;
      },
    });
  };
}

/** The dashboard page, as the web console draws it, for an admin of an organization in `state`. */
export function dashboardJourneyScene(state: JourneyState): Drawing {
  return {
    inOrganization: true,
    routes: (router: ConnectRouter) => {
      router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
      router.service(RunQueryController, {
        getRunSummary: () => (state.ran ? BUSY_WEEK_RUNS : NO_RUNS),
        getOrgUsageReport: () => (state.ran ? BUSY_WEEK_USAGE : EMPTY_USAGE),
        list: () => samples.runList([]),
      });
      journeyRoutes(state)(router);
    },
    render: () => (
      <DashboardFrame>
        <OperationalDashboard org={ORG_ID} firstStepLinks={STEP_LINKS} />
      </DashboardFrame>
    ),
  };
}

/** An agent picked and a key in, nothing run yet: two of six, "Watch it work" next, the card alone. */
export const PICKED_NOT_RUN: JourneyState = { agents: [journeyAgent()], readiness: ANTHROPIC_ONLY, ran: false, changed: false };

/** The agent ran and was changed since: four of six, "Put it in your app" next, the card above the week's figures. */
export const MADE_YOURS: JourneyState = { agents: [journeyAgent()], readiness: ANTHROPIC_ONLY, ran: true, changed: true };

/** The agent ran once and has not changed: "Make it yours" is the step to take. */
const RAN_ONCE: JourneyState = { agents: [journeyAgent()], readiness: ANTHROPIC_ONLY, ran: true, changed: false };

function DashboardFrame({ children }: { readonly children: ReactNode }) {
  return (
    <div style={{ maxWidth: "64rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <PageHeader title="Dashboard" description="What your organization's agents did this week." />
      </div>
      {children}
    </div>
  );
}

/** Every step done, as the card would read it: what the server would say for each. */
const ALL_DONE: UseJourneyReturn = (() => {
  const lines: readonly (readonly [JourneyStep["id"], string, string])[] = [
    ["describe", "Say what it should do", "Variance Reporter is made"],
    ["key", "Add a model key", "Anthropic is connected"],
    ["watch", "Watch it work", "It ran its first job"],
    ["make-yours", "Make it yours", "Variance Reporter has your changes"],
    ["in-app", "Put it in your app", "Its chat is in your app"],
    ["others", "Bring others in", "Your team is here"],
  ];
  const steps = lines.map(([id, title, line], index): JourneyStep => ({ id, number: index + 1, title, state: "done", line }));
  return {
    status: "ready",
    steps,
    done: steps.length,
    current: undefined,
    agent: { ref: { org: ORG_ID, slug: varianceExample().agent.slug }, name: varianceExample().agent.name },
    everRan: true,
  };
})();

/** The card folded to one line at six of six, drawn from a journey passed to it (no server says six of six today). */
export function dashboardJourneyFoldedScene(): Drawing {
  return {
    inOrganization: true,
    routes: (router: ConnectRouter) => {
      router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
    },
    render: () => (
      <DashboardFrame>
        <DashboardFirstSteps org={ORG_ID} links={STEP_LINKS} journey={ALL_DONE} onHide={inert} />
      </DashboardFrame>
    ),
  };
}

/**
 * The agent page opened on "Make it yours", for an editor of the agent the
 * first question made; `makesSkills` false is an editor the server does not
 * let make skills, whose skill card says who adds them. The organization has
 * no skill of the offered name yet.
 */
export function agentMakeItYoursScene(makesSkills: boolean): Drawing {
  const agent = journeyAgent();
  return {
    inOrganization: true,
    routes: (router: ConnectRouter) => {
      agentRoutes("owner", { agent, versions: journeyVersions(false) })(router);
      // An editor of the agent; one who may not make skills may not delete it either.
      router.service(GrantQueryController, {
        checkMyPermission: (input) => ({
          isAuthorized: makesSkills || (input.relation !== "can_create_skill" && input.relation !== "can_delete"),
        }),
      });
      router.service(SkillQueryController, {
        getByReference: (input) => {
          throw new ConnectError(`no skill ${input.slug}`, Code.NotFound);
        },
      });
    },
    render: () => (
      <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <AgentDetailView
          org={ORG_SLUG}
          slug={agent.metadata?.slug ?? ""}
          editable
          primaryAction={START_SESSION}
          actions={MENU}
          makeItYours={JOURNEY_LINKS}
          defaultTab="make-it-yours"
        />
      </div>
    ),
  };
}

/** The variance reporter's first job, finished: the sample sent, the ledger read, the report written and handed back. */
function firstJobReplay(): SessionReplay {
  const example = varianceExample();
  const sample = example.samples[0];
  const session = samples.session({ subject: "Variance report for this quarter", agentRef: { org: "demo", slug: example.agent.slug } });
  const events = numbered(
    samples.turnEvents({
      message: example.message,
      tools: [
        { name: "Read", input: { file_path: sample?.name ?? "ledger.csv" }, result: sample?.text ?? "" },
        { name: "Write", input: { file_path: `/.stigmer/outputs/${example.output}` }, result: "Wrote 1.4 KB" },
      ],
      reply:
        "Three of six accounts moved more than 10% from budget: marketing ran 56.7% over and travel 60% under, and cost of goods sold ran 15% over while revenue grew 9.6%. The report is in variance-report.md, flagged accounts first.",
    }),
  );
  return {
    session,
    events,
    runs: [samples.run({ sessionId: session.metadata!.id, phase: RunPhase.RUN_COMPLETED, message: example.message })],
    files: [samples.outputFile(example.output, { mimeType: "text/markdown", sizeBytes: 1_412n })],
    liveness: undefined,
    loadError: null,
  };
}

/** The first job, finished, with the journey's next line under it, in the console. */
export function sessionFirstJobNextScene(): Drawing {
  const replay = firstJobReplay();
  const session = replay.session!;
  const org = session.metadata!.org;
  const agent = journeyAgent(org);
  return {
    inOrganization: true,
    routes: (router: ConnectRouter) => {
      sessionRoutes(replay, { agent })(router);
      journeyRoutes({ ...RAN_ONCE, agents: [agent] }, { listMine: () => samples.organizationList([SESSION_ORG]) })(router);
      router.service(RunQueryController, {
        getRunSummary: () => BUSY_WEEK_RUNS,
        listBySession: () => samples.runList([...replay.runs]),
        get: () => replay.runs[0]!,
      });
    },
    render: () => (
      <div style={{ height: "calc(100vh - 48px)" }}>
        <SessionViewer
          sessionId={session.metadata!.id}
          org={org}
          inspector={<SessionInspector />}
          nextStep={({ agentRef }) => <JourneyNextLine org={org} agentRef={agentRef} links={JOURNEY_LINKS} />}
        />
      </div>
    ),
  };
}

/** The launcher on the variance reporter for a run on the person's own file, as the agent page's tab opens it. */
export function launcherOwnFileScene(): Drawing {
  const agent = journeyAgent();
  const launch = exampleLaunch({ key: "own-file", agentRef: { org: ORG_ID, slug: agent.metadata?.slug ?? "" }, example: varianceExample(), mode: "own" });
  return {
    inOrganization: true,
    routes: (router: ConnectRouter) => {
      launcherRoutes(ANTHROPIC_ONLY, "admin")(router);
      journeyRoutes(RAN_ONCE)(router);
      router.service(RunQueryController, { getRunSummary: () => BUSY_WEEK_RUNS });
    },
    render: () => (
      <div style={{ height: "calc(100vh - 48px)" }}>
        <NewSessionViewer
          org={ORG_ID}
          onSessionCreated={inert}
          autoFocus={false}
          inspector={<SessionInspector />}
          launch={launch}
          firstQuestion
          journeyLinks={JOURNEY_LINKS}
        />
      </div>
    ),
  };
}

/** The plain launcher once the agent has done its first job: the journey's next step under its heading. */
export function launcherNextLineScene(): Drawing {
  return {
    inOrganization: true,
    routes: (router: ConnectRouter) => {
      launcherRoutes(ANTHROPIC_ONLY, "admin")(router);
      journeyRoutes(RAN_ONCE)(router);
      router.service(RunQueryController, { getRunSummary: () => BUSY_WEEK_RUNS });
    },
    render: () => (
      <div style={{ height: "calc(100vh - 48px)" }}>
        <NewSessionViewer
          org={ORG_ID}
          onSessionCreated={inert}
          autoFocus={false}
          inspector={<SessionInspector />}
          firstQuestion
          journeyLinks={JOURNEY_LINKS}
        />
      </div>
    ),
  };
}
