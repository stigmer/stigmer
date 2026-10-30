// <AgentChat>'s frames, as a product embeds them for its signed-in people:
// a panel docked beside the product's page, and the corner popup, closed
// while a long turn works (its button says what the agent is doing) and
// open on a finished turn. The product's page is a plain surface: the
// frames are what is pictured. The conversation is answered as the session
// view's scenes answer it.
import type { ReactElement } from "react";
import { AgentChat } from "@stigmer/react-sdk";
import { samples, scenarios, type ScenarioName } from "@stigmer/react-sdk/test";
import type { Drawing } from "./drawing.ts";
import { sessionRoutes } from "./session.tsx";

const AGENT = samples.agent().metadata!;

/** The product's page, with the chat beside it or over it. */
function productPage(chat: ReactElement, docked: boolean): ReactElement {
  return (
    <div style={{ height: "calc(100vh - 48px)", display: "flex" }}>
      <div className="stg:flex-1 stg:bg-muted" />
      {docked ? <div style={{ width: 390, flex: "none" }} className="stg:border-l stg:border-border">{chat}</div> : chat}
    </div>
  );
}

/** The `name` conversation in `variant`, open or closed. */
export function agentChatScene(name: ScenarioName, variant: "panel" | "popup", open: boolean): Drawing {
  const scenario = scenarios[name];
  const session = scenario.session ?? samples.session();
  return {
    inOrganization: true,
    routes: sessionRoutes(scenario),
    render: () =>
      productPage(
        <AgentChat
          agent={`${AGENT.org}/${AGENT.slug}`}
          org={session.metadata!.org}
          variant={variant}
          defaultOpen={open}
          defaultSessionId={session.metadata!.id}
        />,
        variant === "panel",
      ),
  };
}
