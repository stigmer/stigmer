// The chat the hooks guide builds (sdk/react-core/examples/chat/Chat.tsx),
// drawn as the guide shows it: the program itself, over a completed turn,
// with the client the page gives every scene. In the docs mode the
// scripted server answers what a reader sends, so the guide's chat works
// on the page with no agent behind it.
import type { ReactElement } from "react";
import { useStigmer } from "@stigmer/react-sdk/headless";
import { samples, scenarios } from "@stigmer/react-sdk/test";
import { Chat } from "../../../../sdk/react-core/examples/chat/Chat.tsx";
import { LiveConversation } from "../live-server.ts";
import type { Drawing } from "./drawing.ts";
import { sessionRoutes } from "./session.tsx";

const AGENT = samples.agent().metadata!;
const SCENARIO = scenarios.completed;
const SESSION = SCENARIO.session!.metadata!;

/** The program, handed the client the page's provider holds, as a host hands it its own. */
function FromHooks(): ReactElement {
  const client = useStigmer();
  return (
    <div style={{ height: "calc(100vh - 48px)" }}>
      <Chat client={client} org={SESSION.org} agent={`${AGENT.org}/${AGENT.slug}`} sessionId={SESSION.id} />
    </div>
  );
}

/** The hooks guide's chat over the `completed` turn. */
export function fromHooksScene(): Drawing {
  return {
    routes: sessionRoutes(SCENARIO),
    liveRoutes: () => new LiveConversation(SCENARIO).routes(),
    render: () => <FromHooks />,
  };
}
