/**
 * The desktop app's Environments list: the kit's section, opened at the resource's
 * address and linked with the router.
 */

import { LibraryEnvironmentsSection } from "@stigmer/react-sdk/console";
import { renderJourneyLink } from "../../journey/journey-links";
import { useLibraryOpen } from "./library-open";

export default function EnvironmentListPage() {
  const onOpen = useLibraryOpen();
  return <LibraryEnvironmentsSection onOpen={onOpen} renderLink={renderJourneyLink} />;
}
