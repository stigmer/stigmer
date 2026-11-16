"use client";

/**
 * The web console's Skills list: the kit's section, opened through the
 * Library overlay's client-side navigation and linked with Next's `Link`.
 */

import { LibrarySkillsSection } from "@stigmer/react-sdk/console";
import { useLibraryOpen } from "@/domain/library/library-navigation";
import { renderJourneyLink } from "@/domain/journey/journey-links";

export function SkillListPage() {
  const onOpen = useLibraryOpen();
  return <LibrarySkillsSection onOpen={onOpen} renderLink={renderJourneyLink} />;
}
