import { useNavigate } from "react-router-dom";
import {
  MarketplaceCatalog,
  PageHeader,
  useActiveOrgId,
  useActiveOrgSlug,
  useOrgSlugForId,
} from "@stigmer/react-sdk";

/**
 * The Marketplace: where a user finds and installs plugins.
 *
 * Mounted at `/marketplace`, a top-level page beside the Library (what you
 * can get, beside what you have). Renders the kit's page heading and the
 * SDK's `MarketplaceCatalog`, which asks the server who may install (a
 * member browses and is told to ask an admin),
 * and routes to the installed plugin's page on completion, from a card or
 * from the Upload tile alike; the same wiring as the web console's page.
 */
export default function MarketplacePage() {
  const org = useActiveOrgId();
  const orgSlug = useActiveOrgSlug();
  const slugForOrg = useOrgSlugForId();
  const navigate = useNavigate();

  if (!org) return null;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <PageHeader
        className="mb-6"
        title="Marketplace"
        description={`Plugins for ${orgSlug}'s agents: tools, skills and whole agents, from Stigmer's catalogue or one you add.`}
      />
      <MarketplaceCatalog
        org={org}
        onInstalled={({ plugin }) =>
          navigate(`/library/plugins/${slugForOrg(plugin.metadata?.org ?? "")}/${plugin.metadata?.slug}`)
        }
      />
    </div>
  );
}
