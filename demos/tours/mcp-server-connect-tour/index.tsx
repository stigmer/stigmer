/**
 * Pure `renderStep` for the sign-in and check-tools tour. The player,
 * cursor, narration, and viewport are supplied by `scenar pack` — this file
 * only maps step data to views.
 *
 * The plugin-page beats render the real plugin page (`_shared/PluginPage`,
 * the real `PluginDetailView` and its `PluginServerRow`). Which side of the
 * sign-in a beat shows is the organization it names (see `steps.ts`): the
 * page is remounted on that change (`key`), so its reads start fresh and
 * the sign-in cell paints the beat's own state. Beats on the same side
 * share a key, so the page stays mounted and only the cursor moves.
 *
 * The login beat is the server's own login page, drawn with Scenar's
 * `LoginCardPage` at the provider's address; the terminal beat is the CLI's
 * listing from `steps.ts`.
 */
import type { ReactNode } from "react";
import { BrowserView, LoginCardPage, TerminalView } from "@scenar/react";
import { AppShell } from "../_shared/AppShell";
import { DEMO_ORG, DEMO_ORG_ID } from "../_shared/fixtures";
import { ORDER_MGMT } from "../_shared/order-management-plugin";
import { PluginPage } from "../_shared/PluginPage";
import { QUICKSTART_WORKSPACE } from "../_shared/quickstart-workspace";
import { CONNECT_OUTPUT, type McpServerConnectTourStep } from "./steps";

/** The plugin page's route, as the address bar shows it. */
const PLUGIN_ROUTE = `app.stigmer.ai/library/plugins/${DEMO_ORG}/${ORDER_MGMT.name}`;

/** The provider's login page host, from the server's own address. */
const LOGIN_HOST = new URL(ORDER_MGMT.url).host;

export function renderStep(data: McpServerConnectTourStep): ReactNode {
  switch (data.view) {
    case "plugin-page": {
      // Signed-in beats name the organization by its id, the others by its
      // slug; the providers answer My vault by which one asked.
      const org = data.signedIn ? DEMO_ORG_ID : DEMO_ORG;
      return (
        // One page throughout: a stable contentKey keeps AppShell from
        // replaying its navigation transition on every beat.
        <BrowserView url={PLUGIN_ROUTE} contentKey="plugin-page">
          <AppShell activeNav="library" contentKey="plugin-page">
            <PluginPage key={org} org={org} slug={ORDER_MGMT.name} serverName={ORDER_MGMT.name} />
          </AppShell>
        </BrowserView>
      );
    }

    case "login":
      return (
        <BrowserView url={`${LOGIN_HOST}/authorize`} contentKey="login" slideDirection="forward">
          <LoginCardPage
            appName={ORDER_MGMT.provider}
            subtitle="Sign in to let Stigmer use the Order Management API"
            fields={[
              { label: "Email", value: "you@acme.com" },
              { label: "Password", type: "password" },
            ]}
            submitLabel="Sign in and allow"
            submitTargetId="login-allow"
          />
        </BrowserView>
      );

    case "terminal":
      return (
        <TerminalView
          title={QUICKSTART_WORKSPACE.terminalTitle}
          cwd={QUICKSTART_WORKSPACE.cwd}
          lines={CONNECT_OUTPUT}
          contentKey="connect"
        />
      );
  }
}
