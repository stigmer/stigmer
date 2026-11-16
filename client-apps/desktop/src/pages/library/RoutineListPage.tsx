/**
 * The desktop app's Routines list: the kit's section, opened at the resource's
 * address and linked with the router.
 */

import { LibraryRoutinesSection } from "@stigmer/react-sdk/console";
import { renderJourneyLink } from "../../journey/journey-links";
import { useLibraryOpen } from "./library-open";

export default function RoutineListPage() {
  const onOpen = useLibraryOpen();
  return <LibraryRoutinesSection onOpen={onOpen} renderLink={renderJourneyLink} />;
}
