/**
 * The desktop app's Agents list: the kit's section, opened at the resource's
 * address and linked with the router.
 */

import { LibraryAgentsSection } from "@stigmer/react-sdk/console";
import { renderJourneyLink } from "../../journey/journey-links";
import { useLibraryOpen } from "./library-open";

export default function AgentListPage() {
  const onOpen = useLibraryOpen();
  return <LibraryAgentsSection onOpen={onOpen} renderLink={renderJourneyLink} />;
}
