// <AgentChat>'s frames, as a product embeds them for its signed-in people:
// a whole page of its own, a panel docked beside the product's page, and
// the corner popup, closed while a long turn works (its button says what
// the agent is doing) and open on a finished turn. The product's page is a plain surface: the
// frames are what is pictured. The conversation is answered as the session
// view's scenes answer it. `dockedBeside` is the panel's docking alone, so
// a scene that draws a product's own page (the story's) docks the panel
// exactly as these do. A chat that cannot start (its agent not found, an
// app user signed in with no role) says why under its box, in the end
// user's words.
import type { ReactElement } from "react";
import { clone } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { AgentChat } from "@stigmer/react-sdk";
import { samples, scenarios, type ScenarioName } from "@stigmer/react-sdk/test";
import { LiveConversation } from "../live-server.ts";
import type { Drawing } from "./drawing.ts";
import { sessionRoutes } from "./session.tsx";
import { ACCOUNT, ORGANIZATION } from "../fixtures.ts";
import { ANTHROPIC_ONLY, launcherRoutes } from "./models.tsx";

const AGENT = samples.agent().metadata!;

/** The product's `page` with the chat docked beside it as a 390-wide panel, the pair one screen tall. */
export function dockedBeside(page: ReactElement, chat: ReactElement): ReactElement {
  return (
    <div style={{ height: "calc(100vh - 48px)", display: "flex" }}>
      {page}
      <div style={{ width: 390, flex: "none" }} className="stg:border-l stg:border-border">
        {chat}
      </div>
    </div>
  );
}

/** The product's page, with the chat beside it or over it. */
function productPage(chat: ReactElement, docked: boolean): ReactElement {
  const surface = <div className="stg:flex-1 stg:bg-muted" />;
  if (docked) return dockedBeside(surface, chat);
  return (
    <div style={{ height: "calc(100vh - 48px)", display: "flex" }}>
      {surface}
      {chat}
    </div>
  );
}

/** The `name` conversation in `variant`, open or closed. */
export function agentChatScene(name: ScenarioName, variant: "page" | "panel" | "popup", open: boolean): Drawing {
  const scenario = scenarios[name];
  const session = scenario.session ?? samples.session();
  return {
    inOrganization: true,
    routes: sessionRoutes(scenario),
    liveRoutes: () => new LiveConversation(scenario).routes(),
    render: () => {
      const chat = (
        <AgentChat
          agent={`${AGENT.org}/${AGENT.slug}`}
          org={session.metadata!.org}
          variant={variant}
          defaultOpen={open}
          defaultSessionId={session.metadata!.id}
        />
      );
      // The page frame is the product's page: the chat fills it.
      if (variant === "page") return <div style={{ height: "calc(100vh - 48px)" }}>{chat}</div>;
      return productPage(chat, variant === "panel");
    },
  };
}

/** Why a scene's chat cannot start: its agent is gone, or its app user was signed in with no role. */
export type ChatSetupFailure = "agent-not-found" | "no-access";

/**
 * `<AgentChat>` as a page, pinned to an agent the server will not give: the
 * agent read answers not found, for a member of the organization whose
 * agent is gone, or for an app user the host signed in with no role (no
 * organization of their own), so the chat says which under its box.
 */
export function agentChatSetupFailedScene(failure: ChatSetupFailure): Drawing {
  const appUser = failure === "no-access";
  const account = clone(IdentityAccountSchema, ACCOUNT);
  if (appUser) account.spec!.provisioningMode = IdentityAccountProvisioningMode.app_user;
  return {
    inOrganization: true,
    routes: (router: ConnectRouter) => {
      launcherRoutes(ANTHROPIC_ONLY, "member")(router);
      router.service(AgentQueryController, {
        getByReference: () => {
          throw new ConnectError("agent not found", Code.NotFound);
        },
      });
      router.service(OrganizationQueryController, {
        listMine: () => samples.organizationList(appUser ? [] : [ORGANIZATION]),
        get: () => ORGANIZATION,
      });
      router.service(IdentityAccountQueryController, { whoAmI: () => account });
    },
    render: () => (
      <div style={{ height: "calc(100vh - 48px)" }}>
        <AgentChat agent={`${ORGANIZATION.metadata!.slug}/${AGENT.slug}`} variant="page" />
      </div>
    ),
  };
}
