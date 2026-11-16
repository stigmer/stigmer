// The Library's pages as they are today, framed as the console's Library
// frames a page (`PageFrame`, the wide column): the landing, and each kind's
// list full, empty for someone who may create one and for a member who may
// not, with nothing matching a search, failed to load, and while it loads;
// the new and upload pages at their first step; and two of the dialogs a list
// opens. They are the pictures a redesign of these pages is measured from.
//
// Every list belongs to the gallery's organization (Acme Corp, `acme`), whose
// owner is Ada; a member is a person the server refuses every create and
// delete but a File's upload, as the organization model has it.
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { FileSchema, type File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { SearchService } from "@stigmer/apis/ai/stigmer/search/v1/query_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import {
  AGENT_TEMPLATES,
  AgentCreationDenied,
  AgentCreationWizard,
  CreationPicker,
  PageHeader,
  PluginUploader,
  SkillUploader,
} from "@stigmer/react-sdk";
import {
  LibraryAgentsSection,
  LibraryEnvironmentsSection,
  LibraryFilesSection,
  LibraryOverview,
  LibraryPluginsSection,
  LibraryRoutinesSection,
  LibrarySkillsSection,
  PageFrame,
} from "@stigmer/react-sdk/console";
import { samples, sampleDate } from "@stigmer/react-sdk/test";
import { useState, type ReactElement, type ReactNode } from "react";
import { DATA_ANALYST, DATA_SCIENCE, VARIANCE_REPORT_SKILL, VARIANCE_REPORTER, varianceRoutine } from "../docs-fixtures.ts";
import { ACCOUNT, LEDGER_AGENT, ORGANIZATION } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";

const ORG_ID = ORGANIZATION.metadata?.id ?? "";
const ORG_SLUG = ORGANIZATION.metadata?.slug ?? "";
const DAY_MS = 86_400_000;

/** A Library kind with a list page. */
export type LibraryKind = "agents" | "skills" | "plugins" | "routines" | "environments" | "files";

/** The state a list is pictured in. */
export type LibraryListState = "full" | "empty" | "empty-member" | "no-match" | "failed" | "loading";

/** The organization's agents: the docs' variance reporter and data analyst, the ledger agent and two more. */
const AGENTS = [
  VARIANCE_REPORTER,
  DATA_ANALYST,
  LEDGER_AGENT,
  samples.agent({
    id: "agt_00000000000000000000000071",
    name: "Support triage",
    slug: "support-triage",
    org: ORG_ID,
    description: "Reads each new support ticket, labels it, and drafts a first reply for a person to send.",
  }),
  samples.agent({
    id: "agt_00000000000000000000000072",
    name: "Release notes",
    slug: "release-notes",
    org: ORG_ID,
    description: "Turns a week's merged pull requests into release notes in the team's voice.",
  }),
];

/** The organization's skills. */
const SKILLS = [
  VARIANCE_REPORT_SKILL,
  samples.skill({
    id: "skl_00000000000000000000000073",
    name: "Brand voice",
    slug: "brand-voice",
    org: ORG_ID,
    description: "How Acme writes: short sentences, plain words, no exclamation marks.",
  }),
  samples.skill({
    id: "skl_00000000000000000000000074",
    name: "Invoice rounding",
    slug: "invoice-rounding",
    org: ORG_ID,
    description: "Round at the invoice total only, half-even to the cent.",
  }),
];

/** The organization's installed plugins. */
const PLUGINS = [
  samples.plugin({
    id: "plg_00000000000000000000000075",
    name: "linear",
    org: ORG_ID,
    description: "Read and update Linear issues from a conversation.",
    serverUrl: "https://mcp.linear.app/mcp",
  }),
  samples.plugin({
    id: "plg_00000000000000000000000076",
    name: "github",
    org: ORG_ID,
    description: "Pull requests, issues and code search on GitHub.",
    serverUrl: "https://api.githubcopilot.com/mcp/",
  }),
];

/** The organization's routines: the docs' daily variance report, on, and a weekly one switched off. */
function routines() {
  const weekly = varianceRoutine(false);
  return [
    varianceRoutine(true),
    {
      ...weekly,
      metadata: { ...weekly.metadata, id: "rtn_00000000000000000000000077", name: "weekly-release-notes", slug: "weekly-release-notes" },
      spec: weekly.spec ? { ...weekly.spec, cron: "0 16 * * 5" } : weekly.spec,
    },
  ] as ReturnType<typeof varianceRoutine>[];
}

/** A File kept in the Library: its name, its type, its size, made `daysAgo` days ago. */
function keptFile(id: string, filename: string, mimeType: string, sizeBytes: bigint, daysAgo: number): StigmerFile {
  const at = timestampFromDate(sampleDate(-daysAgo * DAY_MS));
  return create(FileSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "File",
    metadata: { id, name: filename, slug: id, org: ORG_ID, visibility: ApiResourceVisibility.visibility_org },
    spec: { filename, mimeType },
    status: { sizeBytes, audit: { specAudit: { createdAt: at, updatedAt: at } } },
  });
}

/** The organization's kept Files. */
const FILES = [
  keptFile("fil_00000000000000000000000078", "q3-budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 48_213n, 2),
  keptFile("fil_00000000000000000000000079", "chart-of-accounts.csv", "text/csv", 6_410n, 9),
  keptFile("fil_00000000000000000000000080", "brand-guide.pdf", "application/pdf", 1_284_116n, 30),
];

/** A list call that never answers: the page as it reads. */
const NEVER = () => new Promise<never>(() => {});

/** A list call the server fails. */
function down(): never {
  throw new ConnectError("the library service did not answer", Code.Unavailable);
}

/** The data a Library scene's server answers with. */
interface LibraryData {
  /** Every list empty. */
  readonly empty?: boolean;
  /** A member, refused every create and delete but a File's upload. */
  readonly member?: boolean;
  /** Every read fails. */
  readonly failed?: boolean;
  /** Every list read stays in flight. */
  readonly loading?: boolean;
}

/** The calls the Library's pages make, answered from `data`. */
function libraryRoutes(data: LibraryData) {
  const list = <T,>(entries: readonly T[]) => (data.failed ? down : data.loading ? NEVER : () => ({ entries: data.empty ? [] : [...entries], nextPageToken: "" }));
  const counts: Record<string, number> = data.empty
    ? {}
    : { [ApiResourceKind[ApiResourceKind.agent]]: AGENTS.length, [ApiResourceKind[ApiResourceKind.skill]]: SKILLS.length, [ApiResourceKind[ApiResourceKind.plugin]]: PLUGINS.length };
  return (router: ConnectRouter) => {
    router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
    router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
    router.service(GrantQueryController, {
      checkMyPermission: (input) => ({ isAuthorized: !data.member || input.relation === "can_create_file" || input.relation === "can_view" }),
    });
    router.service(PlatformQueryController, { getServerInfo: () => ({}) });
    router.service(AgentQueryController, { list: list(AGENTS) });
    router.service(SkillQueryController, { list: list(SKILLS) });
    router.service(PluginQueryController, { list: list(PLUGINS) });
    router.service(RoutineQueryController, { list: list(routines()) });
    router.service(EnvironmentQueryController, { list: list([DATA_SCIENCE]) });
    router.service(FileQueryController, { list: list(FILES) });
    router.service(SearchService, {
      // A count is a one-row search for one kind; a typed search matches nothing in these scenes.
      search: data.failed ? down : (input) => (input.query ? { entries: [], countsByKind: {} } : { entries: [], countsByKind: counts }),
    });
  };
}

/** A press the overview's cards and Add menu make go nowhere: the gallery has no routes. */
const stay = () => {};
/** Links drawn as plain anchors that go nowhere. */
const stayLink = ({ href, className, children }: { readonly href: string; readonly className: string; readonly children: ReactNode }) => (
  <a href={href} className={className} onClick={(event) => event.preventDefault()}>
    {children}
  </a>
);

/** One Library list page in the console's frame. */
function ListPage({ kind }: { readonly kind: LibraryKind }): ReactElement {
  const props = { onOpen: stay, renderLink: stayLink };
  const section = {
    agents: <LibraryAgentsSection {...props} />,
    skills: <LibrarySkillsSection {...props} />,
    plugins: <LibraryPluginsSection {...props} />,
    routines: <LibraryRoutinesSection {...props} />,
    environments: <LibraryEnvironmentsSection {...props} />,
    files: <LibraryFilesSection {...props} />,
  }[kind];
  return <PageFrame width="wide">{section}</PageFrame>;
}

/** A Library list in one state. */
export function libraryListScene(kind: LibraryKind, state: LibraryListState): Drawing {
  return {
    inOrganization: true,
    routes: libraryRoutes({
      empty: state === "empty" || state === "empty-member",
      member: state === "empty-member",
      failed: state === "failed",
      loading: state === "loading",
    }),
    uncounted: state === "loading" ? ["list"] : undefined,
    render: () => <ListPage kind={kind} />,
  };
}

/** The Library's landing: for an owner, for a member, or with its counts failed. */
export function libraryLandingScene(state: "owner" | "member" | "failed"): Drawing {
  return {
    inOrganization: true,
    routes: libraryRoutes({ member: state === "member", failed: state === "failed" }),
    render: () => (
      <PageFrame width="wide">
        <LibraryOverview onNavigate={stay} />
      </PageFrame>
    ),
  };
}

/** New agent: the picker, or the wizard's first step once From scratch is chosen; denied for a member. */
function AgentNewPage({ member }: { readonly member: boolean }): ReactElement {
  const [wizard, setWizard] = useState(false);
  if (member) return <AgentCreationDenied />;
  return wizard ? (
    <AgentCreationWizard org={ORG_SLUG} onComplete={stay} onCancel={() => setWizard(false)} />
  ) : (
    <CreationPicker resourceLabel="agent" templates={AGENT_TEMPLATES} onSelect={() => setWizard(true)} />
  );
}

/** The console's New agent page, as the Library frames it. */
export function agentNewScene(member = false): Drawing {
  return {
    inOrganization: true,
    routes: libraryRoutes({ member }),
    render: () => (
      <PageFrame width="wide">
        <AgentNewPage member={member} />
      </PageFrame>
    ),
  };
}

/** The console's Upload skill page at its first step. */
export function skillUploadScene(): Drawing {
  return {
    inOrganization: true,
    routes: libraryRoutes({}),
    render: () => (
      <PageFrame width="wide">
        <SkillUploader org={ORG_SLUG} onComplete={stay} onCancel={stay} />
      </PageFrame>
    ),
  };
}

/** The console's Upload plugin page at its first step. */
export function pluginUploadScene(): Drawing {
  return {
    inOrganization: true,
    routes: libraryRoutes({}),
    render: () => (
      <PageFrame width="wide">
        <PageHeader
          className="stg:mb-6"
          headingLevel={1}
          title="Upload a plugin"
          description={
            <>
              A plugin folder from your computer, or a .zip of one, installed into {ORG_SLUG}. A Cursor, Claude Code, Codex or Agent
              Plugins folder installs unchanged.
            </>
          }
        />
        <PluginUploader org={ORG_SLUG} onComplete={stay} onCancel={stay} />
      </PageFrame>
    ),
  };
}
