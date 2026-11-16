"use client";

/**
 * The web console's Environments list: the kit's section, opened through
 * the Library overlay's client-side navigation and linked with Next's `Link`.
 */

import { LibraryEnvironmentsSection } from "@stigmer/react-sdk/console";
import { useLibraryOpen } from "@/domain/library/library-navigation";
import { renderJourneyLink } from "@/domain/journey/journey-links";

export function EnvironmentListPage() {
  const onOpen = useLibraryOpen();
  return <LibraryEnvironmentsSection onOpen={onOpen} renderLink={renderJourneyLink} />;
}
