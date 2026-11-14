// The deployment's help link where a console shows it: at the foot of the
// sidebar, above the user menu, and at the end of a failure note, "Stuck?
// <words>". The server announces it (`getServerInfo`'s `help`), and a console
// turns the failure notes' line on (`StigmerProvider`'s `showHelpLink`). The
// second scene's server announces none: the sidebar's foot holds the user
// menu alone and the failure note ends at its act, as before.
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";
import {
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { ErrorMessage } from "@stigmer/react-sdk";
import { HelpLink, UserMenu, WorkspaceSidebar } from "@stigmer/react-sdk/console";
import type { Drawing } from "./drawing.ts";

/** A self-hosting company's help: its own words and its own desk. */
const COMPANY_HELP = { url: "https://support.example.com/stigmer", label: "Ask IT on Slack" };

const UNAVAILABLE = new ConnectError("the agent store did not answer", Code.Unavailable);

function serverAnnouncing(help: typeof COMPANY_HELP | undefined) {
  return (router: ConnectRouter) => {
    router.service(PlatformQueryController, {
      getServerInfo: () =>
        create(GetServerInfoOutputSchema, {
          edition: ServerEdition.oss,
          version: "dev",
          authenticationRequired: true,
          // One organization: the sidebar shows no switcher, which reads no organizations.
          singleOrg: true,
          ...(help !== undefined ? { help } : {}),
        }),
    });
  };
}

function HelpScene() {
  return (
    <div style={{ display: "flex", gap: "var(--stgm-space-6, 24px)", alignItems: "stretch", minHeight: 480 }}>
      <div style={{ width: 240, flex: "none", display: "flex" }}>
        <WorkspaceSidebar
          activeNav="new-session"
          renderLink={({ href, children, id: _id, active: _active, ...rest }) => (
            // The console's router link draws no underline; nor does this one.
            <a href={href} {...rest} style={{ textDecoration: "none" }}>
              {children}
            </a>
          )}
          recentActivity={{ entries: [] }}
          footer={
            <>
              <HelpLink variant="row" />
              <UserMenu user={{ name: "Dana Reyes", email: "dana@example.com" }} onSignOut={() => {}} />
            </>
          }
          now={new Date("2026-11-14T10:00:00Z")}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <ErrorMessage error={UNAVAILABLE} title="Couldn't load your agents." retry={() => {}} />
      </div>
    </div>
  );
}

/** The sidebar's foot and a failure note, on a server that names where to ask. */
export function helpScene(): Drawing {
  return { render: () => <HelpScene />, routes: serverAnnouncing(COMPANY_HELP), showHelpLink: true };
}

/** The same, on a server that names nowhere: no row, no line. */
export function helpNoneScene(): Drawing {
  return { render: () => <HelpScene />, routes: serverAnnouncing(undefined), showHelpLink: true };
}
