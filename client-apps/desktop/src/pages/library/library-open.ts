/**
 * Opens a resource from one of the kit's Library sections at its address,
 * which names the organization by its slug, as every desktop address does.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useOrgSlugForId } from "@stigmer/react-sdk";
import type { LibraryResourceRef } from "@stigmer/react-sdk/console";

export function useLibraryOpen(): (resource: LibraryResourceRef) => void {
  const navigate = useNavigate();
  const slugForOrg = useOrgSlugForId();
  return useCallback(
    (resource: LibraryResourceRef) => navigate(`/library/${resource.kind}/${slugForOrg(resource.org)}/${resource.slug}`),
    [navigate, slugForOrg],
  );
}
