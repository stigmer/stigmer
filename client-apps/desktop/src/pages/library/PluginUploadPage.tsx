import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  PluginUploader,
  useActiveOrgSlug,
  useBreadcrumbOverride,
} from "@stigmer/react";

/**
 * Console page for uploading a plugin from the user's computer: the
 * console's `stigmer push plugin`.
 *
 * Mounted at `/library/plugins/upload` (not `new`: a plugin is never
 * authored here). Renders the SDK's `PluginUploader` and handles routing on
 * completion (the plugin's page) and cancellation (the list); the same
 * wiring as the web console's page.
 */
export default function PluginUploadPage() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("Upload plugin");
    return () => setLabel(null);
  }, [setLabel]);

  if (!org) return null;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">Upload a plugin</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          A plugin folder from your computer, or a .zip of one, installed into {org}. A Cursor, Claude Code, Codex or
          Agent Plugins folder installs unchanged.
        </p>
      </div>
      <PluginUploader
        org={org}
        onComplete={({ plugin }) =>
          navigate(`/library/plugins/${plugin.metadata?.org}/${plugin.metadata?.slug}`)
        }
        onCancel={() => navigate("/library/plugins")}
      />
    </>
  );
}
