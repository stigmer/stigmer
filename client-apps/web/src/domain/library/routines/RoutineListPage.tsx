"use client";

/**
 * The web console's Routines list: the kit's section, opened through the
 * Library overlay's client-side navigation and linked with Next's `Link`.
 */

import { LibraryRoutinesSection } from "@stigmer/react-sdk/console";
import { useLibraryOpen } from "@/domain/library/library-navigation";
import { renderJourneyLink } from "@/domain/journey/journey-links";

export function RoutineListPage() {
  const onOpen = useLibraryOpen();
  return <LibraryRoutinesSection onOpen={onOpen} renderLink={renderJourneyLink} />;
}
