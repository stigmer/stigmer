"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
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
 * completion (the plugin's page) and cancellation (the list).
 */
export function PluginUploadPage() {
  const org = useActiveOrgSlug();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("Upload plugin");
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
          router.push(`/library/plugins/${plugin.metadata?.org}/${plugin.metadata?.slug}`)
        }
        onCancel={() => router.push("/library/plugins")}
      />
    </>
  );
}
