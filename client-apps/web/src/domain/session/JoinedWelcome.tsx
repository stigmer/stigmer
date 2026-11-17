"use client";

/**
 * The launcher's welcome for a teammate who has just joined an organization
 * through an invite link (stigmer#3208): one centered line naming the
 * organization, and under it the agents they can see there, newest first,
 * each a one-click link that opens the launcher on that agent
 * (`getAgentSessionUrl`). With no agents to show, only the line.
 *
 * It reads the agent list a member already reads in the Library; it adds
 * no request of its own and no server change. The launcher decides when it
 * shows (`SessionLauncher.tsx`); this module only draws it.
 */
import { LinkButton, useAgentList, useOrgSlugForId } from "@stigmer/react-sdk";
import { renderJourneyLink } from "@/domain/journey/journey-links";
import { getAgentSessionUrl } from "@/domain/session/session-url";

/** How many of the team's agents the welcome offers: a handful, not the Library. */
export const JOINED_AGENTS_SHOWN = 4;

/** Props for {@link JoinedWelcome}. */
export interface JoinedWelcomeProps {
  /** The joined organization's id, whose agents are listed. */
  readonly org: string;
  /** The organization's name as the person reads it. */
  readonly orgName: string;
}

/** The joined line, and the team's agents to start from. */
export function JoinedWelcome({ org, orgName }: JoinedWelcomeProps) {
  const { agents } = useAgentList(org, { pageSize: JOINED_AGENTS_SHOWN });
  const slugForOrg = useOrgSlugForId();
  const shown = agents.slice(0, JOINED_AGENTS_SHOWN);

  return (
    <section aria-label={`Joined ${orgName}`} className="space-y-3 text-center">
      <p className="text-muted-foreground m-0 text-sm">
        You&rsquo;ve joined <b className="text-foreground font-semibold">{orgName}</b>.
        {shown.length > 0 && " Start with one of the team’s agents:"}
      </p>
      {shown.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap justify-center gap-2 p-0">
          {shown.map((agent) => (
            <li key={agent.id || `${agent.org}/${agent.slug}`}>
              <LinkButton
                href={getAgentSessionUrl(slugForOrg(agent.org || org), agent.slug)}
                variant="outline"
                renderLink={renderJourneyLink}
              >
                {agent.name || agent.slug}
              </LinkButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
