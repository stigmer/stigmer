"use client";

import { useRouter } from "next/navigation";
import {
  MarketplaceCatalog,
  PageHeader,
  useActiveOrgId,
  useActiveOrgSlug,
  useOrgSlugForId,
} from "@stigmer/react-sdk";
import { PageFrame } from "@stigmer/react-sdk/console";

/**
 * The Marketplace: where a user finds and installs plugins.
 *
 * Mounted at `/marketplace`, a top-level page beside the Library (what you
 * can get, beside what you have). Renders the kit's page heading and the
 * SDK's `MarketplaceCatalog`, which asks the server who may install (a
 * member browses and is told to ask an admin),
 * and routes to the installed plugin's page on completion, from a card or
 * from the Upload tile alike; everything else (the sources, the search,
 * the grid, the preview, the upload, the push) is the SDK's.
 */
export function MarketplacePage() {
  const org = useActiveOrgId();
  const orgSlug = useActiveOrgSlug();
  const slugForOrg = useOrgSlugForId();
  const router = useRouter();

  if (!org) return null;

  return (
    <PageFrame width="wide">
      <PageHeader
        className="mb-6"
        title="Marketplace"
        description={`Plugins for ${orgSlug}'s agents: tools, skills and whole agents, from Stigmer's catalogue or one you add.`}
      />
      <MarketplaceCatalog
        org={org}
        onInstalled={({ plugin }) =>
          router.push(`/library/plugins/${slugForOrg(plugin.metadata?.org ?? "")}/${plugin.metadata?.slug}`)
        }
      />
    </PageFrame>
  );
}
