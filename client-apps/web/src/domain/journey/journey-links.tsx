"use client";

/**
 * The console's routes for the journey from a first agent to its users,
 * in one place: the dashboard's card, the launcher's next line, the line
 * under a first job and the agent page's "Make it yours" tab all link
 * through these, drawn with Next's `Link`. An agent's organization arrives
 * as an id (a session or a stored reference names it so) and is written as
 * its slug, as every console address names an organization.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useOrgSlugForId, type JourneyLinks, type MakeItYoursLinks, type RenderJourneyLink } from "@stigmer/react-sdk";
import type { ResourceRef } from "@stigmer/client";
import { getAgentLaunchUrl } from "@/domain/session/session-url";

/** Draws a journey link with Next's client-side navigation. */
export const renderJourneyLink: RenderJourneyLink = ({ href, className, children }) => (
  <Link href={href} className={className}>
    {children}
  </Link>
);

/** The members page, where the team is invited. */
export const MEMBERS_HREF = "/settings/members";

/** The agent page's address on one of its tabs. */
function agentTabHref(org: string, agent: ResourceRef, tab: string): string {
  return `/library/agents/${encodeURIComponent(org)}/${encodeURIComponent(agent.slug)}?tab=${tab}`;
}

/** The journey's later destinations, in the console's routing. */
export function useJourneyLinks(): JourneyLinks & MakeItYoursLinks {
  const slugForOrg = useOrgSlugForId();
  return useMemo(
    () => ({
      makeItYours: (agent: ResourceRef) => agentTabHref(slugForOrg(agent.org), agent, "make-it-yours"),
      putInApp: (agent: ResourceRef) => agentTabHref(slugForOrg(agent.org), agent, "channels"),
      bringOthers: MEMBERS_HREF,
      launch: ({ agent, example, mode }) => getAgentLaunchUrl(slugForOrg(agent.org), agent.slug, { example, mode }),
      renderLink: renderJourneyLink,
    }),
    [slugForOrg],
  );
}
