// The bring-your-own-Slack-app page's screens
// (docs/guides/channels/bring-your-own-slack-app.mdx), framed as the
// console's Settings frames a page: Channel Apps with the register form
// filled with the page's bot name, and the registered app's detail panel
// with its Finish setup in Slack.
import type { ConnectRouter } from "@connectrpc/connect";
import { ChannelAppQueryController } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/query_pb";
import { ChannelAppsSection } from "@stigmer/react-sdk/console";
import { ACME_BOOKS_SLACK_APP } from "../docs-fixtures.ts";
import type { Drawing } from "./drawing.ts";
import { settingsScene } from "./settings-pages.tsx";

/** Settings → Channel Apps: none registered yet, or the page's Slack app registered. */
export function channelAppsScene(registered: boolean): Drawing {
  return {
    ...settingsScene(
      () => <ChannelAppsSection />,
      (router: ConnectRouter) => {
        router.service(ChannelAppQueryController, { list: () => ({ entries: registered ? [ACME_BOOKS_SLACK_APP] : [] }) });
      },
    ),
    // Stigmer Cloud's API, the address the hosted console's events URL names.
    publicBaseUrl: "https://api.stigmer.ai",
  };
}
