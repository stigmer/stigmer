"use client";

/**
 * The web console's Agents list: the kit's section, opened through the
 * Library overlay's client-side navigation and linked with Next's `Link`.
 */

import { LibraryAgentsSection } from "@stigmer/react-sdk/console";
import { useLibraryOpen } from "@/domain/library/library-navigation";
import { renderJourneyLink } from "@/domain/journey/journey-links";

export function AgentListPage() {
  const onOpen = useLibraryOpen();
  return <LibraryAgentsSection onOpen={onOpen} renderLink={renderJourneyLink} />;
}
