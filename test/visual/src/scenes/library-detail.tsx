// The Library's detail pages in the states their drawings name and no other
// scene draws: an agent page while it loads, when its read fails and when
// the agent isn't there; a plugin's page, its Remove asked first and its
// Evals; an environment's page, its network being changed and a member's
// read-only view; and the skill upload page after a package is chosen
// or refused.
//
// A gallery act presses and types, it can't drop a file, so the upload
// scene hands the page's own file input a .zip built here, as a person's
// drop would, once the page is drawn.
import { useEffect, type ReactElement } from "react";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { strToU8, zipSync } from "fflate";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { AgentDetailView, ConfirmDialog, EnvironmentDetailView, PluginDetailView } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import { DATA_SCIENCE } from "../docs-fixtures.ts";
import { ACCOUNT, LEDGER_AGENT, ORGANIZATION } from "../fixtures.ts";
import { MENU, START_SESSION } from "./agent.tsx";
import type { Drawing } from "./drawing.ts";
import { skillUploadScene } from "./library.tsx";

const ORG_SLUG = ORGANIZATION.metadata?.slug ?? "";
const ORG_ID = ORGANIZATION.metadata?.id ?? "";

/** A detail page's centred column, as the console's Library frames one. */
function column(page: ReactElement): ReactElement {
  return <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>{page}</div>;
}

/** Who the page belongs to and what they may do: an admin, or a member who may only read. */
function baseRoutes(router: ConnectRouter, may: boolean): void {
  router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
  router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
  router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: may }), listResourceAccessByPrincipal: () => ({ entries: [] }) });
  router.service(PlatformQueryController, {
    getServerInfo: () => ({ environments: { applies: true, limitedNetworking: true, packages: true } }),
  });
}

/** How an agent's page read goes: still out, refused by a server that didn't answer, or not there. */
export type AgentPageRead = "loading" | "failed" | "not-found";

/** The ledger agent's page while its read is out, when it fails, or when the agent isn't there. */
export function agentPageReadScene(read: AgentPageRead): Drawing {
  const answer = () => {
    if (read === "loading") return new Promise<never>(() => {});
    if (read === "failed") throw new ConnectError("the agent store did not answer", Code.Unavailable);
    throw new ConnectError("agent not found", Code.NotFound);
  };
  return {
    inOrganization: true,
    uncounted: read === "loading" ? ["getByReference", "get"] : undefined,
    routes: (router) => {
      baseRoutes(router, true);
      router.service(AgentQueryController, { getByReference: answer, get: answer });
    },
    render: () =>
      column(
        <AgentDetailView headingLevel={1} org={ORG_SLUG} slug={LEDGER_AGENT.metadata?.slug ?? ""} editable primaryAction={START_SESSION} actions={MENU} />,
      ),
  };
}

/** The plugin the Library's plugin page shows: acme's ledger tools, one MCP server. */
const LEDGER_TOOLS = samples.plugin({
  id: "plg_00000000000000000000000081",
  name: "ledger-tools",
  org: ORG_ID,
  description: "Reads and posts to acme's general ledger.",
  serverUrl: "https://ledger.acme.example/mcp",
});

function pluginRoutes(router: ConnectRouter, may: boolean): void {
  baseRoutes(router, may);
  router.service(PluginQueryController, {
    getByReference: () => LEDGER_TOOLS,
    get: () => LEDGER_TOOLS,
    listVersions: () => ({ entries: [] }),
  });
  router.service(AgentQueryController, { list: () => ({ entries: [] }) });
}

/** The plugin's page as an admin sees it; with `removing`, its Remove asked first in the destructive confirm. */
export function pluginDetailScene(removing = false): Drawing {
  return {
    inOrganization: true,
    routes: (router) => pluginRoutes(router, true),
    render: () =>
      column(
        <>
          <PluginDetailView headingLevel={1} org={ORG_SLUG} slug={LEDGER_TOOLS.metadata?.slug ?? ""} />
          <ConfirmDialog
            state={
              removing
                ? {
                    title: "Remove ledger-tools?",
                    description:
                      "Removes the plugin and its versions. The server refuses while an agent of the organization uses it; a conversation that uses it fails its next message.",
                    confirmLabel: "Remove",
                    variant: "destructive",
                    resolve: () => {},
                  }
                : null
            }
            onConfirm={() => {}}
            onCancel={() => {}}
          />
        </>,
      ),
  };
}

/** The data-science Environment's page, as an admin (who may change it) or a member (who may only read it) sees it. */
export function environmentDetailScene(member = false): Drawing {
  return {
    inOrganization: true,
    routes: (router) => {
      baseRoutes(router, !member);
      router.service(EnvironmentQueryController, {
        getByReference: () => DATA_SCIENCE,
        get: () => DATA_SCIENCE,
        list: () => ({ entries: [DATA_SCIENCE] }),
      });
      router.service(AgentQueryController, { list: () => ({ entries: [] }) });
    },
    render: () => column(<EnvironmentDetailView headingLevel={1} org={ORG_SLUG} slug={DATA_SCIENCE.metadata?.slug ?? ""} />),
  };
}

/** Hands the page's own .zip input a package built from `files`, as a person's drop would, once the page is drawn. */
function DropOnce({ name, files }: { readonly name: string; readonly files: Readonly<Record<string, string>> }) {
  useEffect(() => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept=".zip"]');
    if (input === null) return;
    const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)])));
    const chosen = new DataTransfer();
    chosen.items.add(new File([bytes], name, { type: "application/zip" }));
    input.files = chosen.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, [name, files]);
  return null;
}

/** A skill package as the upload page reads it: a SKILL.md that names it, and the files it refers to. */
const MONTH_END_CLOSE = {
  "SKILL.md": "---\nname: month-end-close\ndescription: The month-end checklist, in order, with who signs off each step.\n---\n\n# Month-end close\n\nClose the books in this order. Don't move to a step until the one before it is signed off.\n",
  "checklist.md": "1. Reconcile every bank account.\n2. Post the approved accruals.\n3. Run the variance report.\n",
  "signoff.csv": "step,owner\nreconcile,controller\n",
};

/** What the upload page is handed: a skill package, a file that isn't one, or nothing. */
export type SkillDrop = "package" | "not-a-skill";

/** The Upload skill page after a package is chosen, before anything is uploaded; or after a .zip that isn't a skill. */
export function skillUploadDropScene(drop: SkillDrop): Drawing {
  const page = skillUploadScene();
  return {
    ...page,
    render: () => (
      <>
        {page.render()}
        {drop === "package" ? (
          <DropOnce name="month-end-close.zip" files={MONTH_END_CLOSE} />
        ) : (
          <DropOnce name="month-end.zip" files={{ "notes.txt": "Not a skill: there is no SKILL.md here.\n" }} />
        )}
      </>
    ),
  };
}
