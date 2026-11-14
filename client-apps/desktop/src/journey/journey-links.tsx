/**
 * The app's routes for the journey from a first agent to its users, in one
 * place: the dashboard's card, the launcher's next line, the line under a
 * first job and the agent page's "Make it yours" and "In your app" tabs all
 * link through these, drawn with the router's `Link` so the hash routes hold. Mirrors
 * the web console's `domain/journey/journey-links.tsx`; an agent's
 * organization arrives as an id and is written as its slug.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useOrgSlugForId, type InAppLinks, type JourneyLinks, type MakeItYoursLinks, type RenderJourneyLink } from "@stigmer/react-sdk";
import type { ResourceRef } from "@stigmer/client";

/** Draws a journey link with the router. */
export const renderJourneyLink: RenderJourneyLink = ({ href, className, children }) => (
  <Link to={href} className={className}>
    {children}
  </Link>
);

/** The members page, where roles are set. */
export const MEMBERS_HREF = "/settings/members";

/** The journey's last step: name the organization, invite the team, see who joined. */
export const BRING_OTHERS_IN_HREF = "/settings/bring-others-in";

/** The settings the agent page's "In your app" tab links: service accounts and embedding. */
export const SERVICE_ACCOUNTS_HREF = "/settings/service-accounts";
export const EMBEDDING_HREF = "/settings/org-embedding";

/** The agent page's address on one of its tabs. */
function agentTabHref(org: string, agent: ResourceRef, tab: string): string {
  return `/library/agents/${encodeURIComponent(org)}/${encodeURIComponent(agent.slug)}?tab=${tab}`;
}

/**
 * The launcher on an agent, for a run on its example's sample or on a file
 * of the person's own; mirrors the web console's `getAgentLaunchUrl`.
 */
export function agentLaunchUrl(org: string, slug: string, launch: { readonly example: string | undefined; readonly mode: "sample" | "own" }): string {
  const params = new URLSearchParams({ agent: `${org}/${slug}` });
  if (launch.example) params.set("example", launch.example);
  params.set("with", launch.mode);
  return `/?${params.toString()}`;
}

/** The journey's later destinations, in the app's routing. */
export function useJourneyLinks(): JourneyLinks & MakeItYoursLinks & InAppLinks {
  const slugForOrg = useOrgSlugForId();
  return useMemo(
    () => ({
      makeItYours: (agent: ResourceRef) => agentTabHref(slugForOrg(agent.org), agent, "make-it-yours"),
      putInApp: (agent: ResourceRef) => agentTabHref(slugForOrg(agent.org), agent, "in-app"),
      bringOthers: BRING_OTHERS_IN_HREF,
      serviceAccounts: SERVICE_ACCOUNTS_HREF,
      embedding: EMBEDDING_HREF,
      launch: ({ agent, example, mode }) => agentLaunchUrl(slugForOrg(agent.org), agent.slug, { example, mode }),
      renderLink: renderJourneyLink,
    }),
    [slugForOrg],
  );
}
