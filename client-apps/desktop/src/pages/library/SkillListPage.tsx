/**
 * The desktop app's Skills list: the kit's section, opened at the resource's
 * address and linked with the router.
 */

import { LibrarySkillsSection } from "@stigmer/react-sdk/console";
import { renderJourneyLink } from "../../journey/journey-links";
import { useLibraryOpen } from "./library-open";

export default function SkillListPage() {
  const onOpen = useLibraryOpen();
  return <LibrarySkillsSection onOpen={onOpen} renderLink={renderJourneyLink} />;
}
