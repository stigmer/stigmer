/**
 * The desktop app's Files list: the kit's section, opened at the resource's
 * address and linked with the router.
 */

import { LibraryFilesSection } from "@stigmer/react-sdk/console";
import { renderJourneyLink } from "../../journey/journey-links";
import { useLibraryOpen } from "./library-open";

export default function FileListPage() {
  const onOpen = useLibraryOpen();
  return <LibraryFilesSection onOpen={onOpen} renderLink={renderJourneyLink} />;
}
