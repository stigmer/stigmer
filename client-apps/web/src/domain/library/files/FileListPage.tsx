"use client";

/**
 * The web console's Files list: the kit's section; a skill added from a
 * File opens through the Library overlay's client-side navigation.
 */

import { LibraryFilesSection } from "@stigmer/react-sdk/console";
import { useLibraryOpen } from "@/domain/library/library-navigation";

export function FileListPage() {
  const onOpen = useLibraryOpen();
  return <LibraryFilesSection onOpen={onOpen} />;
}
