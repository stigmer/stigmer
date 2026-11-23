// The chat the hooks guide builds (sdk/react-core/examples/chat/Chat.tsx),
// drawn as the guide shows it: the program itself, with the client the page
// gives every scene, over one of the kit's scenarios. `from-hooks` draws a
// finished turn with an edit and two made files; in the docs mode the
// scripted server answers what a reader sends, so the guide's chat works on
// the page with no agent behind it. The other three draw the parts a long
// guide teaches over their own scenarios: a turn at work under its plan
// with a helper, a turn's changed files to keep or undo, and a call of the
// app's own tool waiting for its answer.
import type { ReactElement } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { useStigmer } from "@stigmer/react-sdk/headless";
import { samples, scenarios, type Scenario } from "@stigmer/react-sdk/test";
import { Chat } from "../../../../sdk/react-core/examples/chat/Chat.tsx";
import { LiveConversation } from "../live-server.ts";
import type { Drawing } from "./drawing.ts";
import { sessionRoutes } from "./session.tsx";

const AGENT = samples.agent().metadata!;

/** The program, handed the client the page's provider holds, as a host hands it its own. */
function FromHooks({ scenario }: { scenario: Scenario }): ReactElement {
  const client = useStigmer();
  const session = scenario.session!.metadata!;
  return (
    // The example is deliberately unstyled (it shows the hooks, not the kit's
    // look), so the kit's layout audit does not read it.
    <div style={{ height: "calc(100vh - 48px)" }} data-layout-audit="skip">
      <Chat client={client} org={session.org} agent={`${AGENT.org}/${AGENT.slug}`} sessionId={session.id} />
    </div>
  );
}

/**
 * A made file opens in a new tab: each of the scenario's Files answers its
 * download with a short page of its own text, so a reader who opens one on
 * the docs page sees a file, never a blank tab.
 */
function openable(files: readonly StigmerFile[]): { readonly file: StigmerFile; readonly url: string }[] {
  return files.map((file) => ({
    file,
    url: URL.createObjectURL(new Blob([`${file.spec?.filename ?? "file"}: a file the agent made in this example.\n`], { type: "text/plain" })),
  }));
}

/** The hooks guide's chat over `scenario`; `live` lets a docs reader talk to it. */
function fromHooksDrawing(scenario: Scenario, live: boolean): Drawing {
  return {
    routes: sessionRoutes(scenario, { attachments: openable(scenario.files) }),
    ...(live ? { liveRoutes: () => new LiveConversation(scenario).routes({ attachments: openable(scenario.files) }) } : {}),
    render: () => <FromHooks scenario={scenario} />,
  };
}

/** The hooks guide's chat over the `finished` turn: an edit, two made files and the answer. */
export function fromHooksScene(): Drawing {
  return fromHooksDrawing(scenarios.finished, true);
}

/** The guide's chat over a long turn at work: to-dos with their steps, a helper. */
export function fromHooksBusyScene(): Drawing {
  return fromHooksDrawing(scenarios.busy, false);
}

/** The guide's chat over a turn's two changed files, each to keep or undo. */
export function fromHooksFileReviewScene(): Drawing {
  return fromHooksDrawing(scenarios["file-review"], false);
}

/** The guide's chat over a call of the app's own tool, waiting for the app. */
export function fromHooksWaitingOnAppScene(): Drawing {
  return fromHooksDrawing(scenarios["waiting-on-app"], false);
}
