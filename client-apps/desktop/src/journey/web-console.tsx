/**
 * Where people the desktop app invites open their invitation. The app's own
 * window has an origin nobody else can reach, so a link people open goes to
 * a web console, and the app knows one address for that: its build's
 * console (`CONSOLE_URL`), which fronts its build's server. Connected to
 * any other server, the app knows no console address for it, so it makes
 * no link: one at the build's console would hand that server's invitation
 * token to another site. The pages then send the person to their server's
 * web console. The kit reads `null` as "no address known here".
 */
import { BringOthersIn } from "@stigmer/react-sdk";
import { InvitationsSection } from "@stigmer/react-sdk/console";
import { buildDefaultServer, CONSOLE_URL } from "../config";
import { useServer } from "../server/ServerProvider";
import { MEMBERS_HREF, renderJourneyLink } from "./journey-links";

/** The build's web console fronts the chosen server: both are the build's own. */
export function frontsServer(serverOrigin: string, buildServer: string): boolean {
  try {
    return serverOrigin !== "" && new URL(serverOrigin).origin === new URL(buildServer).origin;
  } catch {
    return false;
  }
}

/** The invite link for a token at the build's console, or `null` when it does not front the chosen server. */
export function useWebConsoleInviteUrl(): ((token: string) => string) | null {
  const { origin } = useServer();
  return frontsServer(origin, buildDefaultServer()) ? (token) => `${CONSOLE_URL}/invite/${token}` : null;
}

/** The journey's last step, its links at the web console that fronts the chosen server. */
export function DesktopBringOthersIn() {
  const inviteUrl = useWebConsoleInviteUrl();
  return (
    <BringOthersIn
      buildInviteUrl={inviteUrl}
      consoleUrl={inviteUrl === null ? null : CONSOLE_URL}
      membersHref={MEMBERS_HREF}
      billingHref="#/settings/billing"
      renderLink={renderJourneyLink}
    />
  );
}

/** The Invitations page, its links at that web console when the app knows it. */
export function DesktopInvitationsSection() {
  const inviteUrl = useWebConsoleInviteUrl();
  return <InvitationsSection {...(inviteUrl === null ? {} : { buildInviteUrl: inviteUrl })} />;
}
