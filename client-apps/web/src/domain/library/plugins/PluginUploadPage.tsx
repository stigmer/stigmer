"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  PluginUploader,
  useActiveOrgId,
  useActiveOrgSlug,
  useBreadcrumbOverride,
  useOrgSlugForId,
  PageHeader,
} from "@stigmer/react-sdk";

/**
 * Console page for uploading a plugin from the user's computer: the
 * console's `stigmer push plugin`.
 *
 * Mounted at `/library/plugins/upload` (not `new`: a plugin is never
 * authored here). Renders the SDK's `PluginUploader` and handles routing on
 * completion (the plugin's page) and cancellation (the list).
 */
export function PluginUploadPage() {
  const org = useActiveOrgId();
  const orgSlug = useActiveOrgSlug();
  const slugForOrg = useOrgSlugForId();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("Upload plugin");
  }, [setLabel]);

  if (!org) return null;

  return (
    <>
      <PageHeader
        className="mb-6"
        headingLevel={1}
        title="Upload a plugin"
        description={
          <>
            A plugin folder from your computer, or a .zip of one, installed into {orgSlug}. A Cursor, Claude Code, Codex or
            Agent Plugins folder installs unchanged.
          </>
        }
      />
      <PluginUploader
        org={org}
        onComplete={({ plugin }) =>
          router.push(`/library/plugins/${slugForOrg(plugin.metadata?.org ?? "")}/${plugin.metadata?.slug}`)
        }
        onCancel={() => router.push("/library/plugins")}
      />
    </>
  );
}
