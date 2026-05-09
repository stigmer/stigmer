"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  AgentCreationWizard,
  useActiveOrgSlug,
  useBreadcrumbOverride,
} from "@stigmer/react";

/**
 * Console page for creating a new agent via the wizard.
 *
 * Mounted at `/library/agents/new`. Renders the SDK's
 * `AgentCreationWizard` component and handles routing on
 * completion (navigate to detail) and cancellation (navigate to list).
 */
export function AgentNewPage() {
  const org = useActiveOrgSlug();
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();

  useEffect(() => {
    setLabel("New agent");
  }, [setLabel]);

  if (!org) return null;

  return (
    <AgentCreationWizard
      org={org}
      onComplete={(result) =>
        router.push(`/library/agents/${result.org}/${result.slug}`)
      }
      onCancel={() => router.push("/library/agents")}
      className="min-h-[480px]"
    />
  );
}
