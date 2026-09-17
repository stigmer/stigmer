import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  MarketplaceBrowser,
  useActiveOrgSlug,
  useBreadcrumbOverride,
} from "@stigmer/react";

/**
 * Console page for installing a plugin from a marketplace.
 *
 * Mounted at `/library/plugins/install` (not `new`: a plugin is never
 * authored here, it is installed). Renders the SDK's `MarketplaceBrowser`
 * and handles routing on completion (navigate to the plugin's detail).
 */
export default function PluginInstallPage() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("Install plugin");
    return () => setLabel(null);
  }, [setLabel]);

  if (!org) return null;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">Install a plugin</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Browse a marketplace and install a plugin into {org}. A Cursor, Claude Code or Codex plugin installs
          unchanged.
        </p>
      </div>
      <MarketplaceBrowser
        org={org}
        onInstalled={({ plugin }) =>
          navigate(`/library/plugins/${plugin.metadata?.org}/${plugin.metadata?.slug}`)
        }
      />
    </>
  );
}
