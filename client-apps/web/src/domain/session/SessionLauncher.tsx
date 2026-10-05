"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  NewSessionViewer,
  useAccountExecutionDefaults,
  useGitHubConnection,
  useGitHubTreeLister,
  useGitHubFileReader,
  useWorkspaceSources,
  useActiveOrgId,
} from "@stigmer/react";
import type { ResourceRef } from "@stigmer/sdk";
import { useSessionNavigation } from "@/domain/session/session-navigation";

/**
 * Console-specific session launcher — thin shell that composes the SDK
 * `NewSessionViewer` with Console routing, org context, and the
 * `?agent=org/slug` URL parameter a "Start session" action arrives with.
 */
export function SessionLauncher() {
  const rawSearchParams = useSearchParams();
  const org = useActiveOrgId();
  const accountDefaults = useAccountExecutionDefaults();
  const gitHubConnection = useGitHubConnection(org);
  const { enableGitHub, enableLocal } = useWorkspaceSources();
  const workspaceFileLister = useGitHubTreeLister(gitHubConnection.token);
  const workspaceFileReader = useGitHubFileReader(gitHubConnection.token);
  const { navigateToSession } = useSessionNavigation();

  // -------------------------------------------------------------------------
  // Explicit agent capture ("Start session" from an agent). Captured once so
  // the URL can be cleaned without losing intent.
  // -------------------------------------------------------------------------

  const liveAgentParam = rawSearchParams.get("agent");

  const [initialAgentRef, setInitialAgentRef] = useState<ResourceRef | undefined>(
    () => parseAgentParam(liveAgentParam),
  );

  if (initialAgentRef === undefined && liveAgentParam) {
    setInitialAgentRef(parseAgentParam(liveAgentParam));
  }

  useEffect(() => {
    if (liveAgentParam) {
      window.history.replaceState({}, "", "/");
    }
  }, [liveAgentParam]);

  return (
    <NewSessionViewer
      org={org}
      onSessionCreated={navigateToSession}
      onError={(msg) => toast.error(msg)}
      accountDefaults={accountDefaults}
      gitHubConnection={enableGitHub ? gitHubConnection : undefined}
      enableGitHub={enableGitHub}
      enableLocal={enableLocal}
      workspaceFileLister={workspaceFileLister}
      workspaceFileReader={workspaceFileReader}
      initialAgentRef={initialAgentRef}
      className="h-full"
    />
  );
}

/**
 * Parse an `agent` query param of the form `org/slug` into a
 * {@link ResourceRef}. Returns `undefined` when absent or malformed.
 */
function parseAgentParam(value: string | null): ResourceRef | undefined {
  if (!value) return undefined;
  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0 || slashIndex === value.length - 1) return undefined;
  return {
    org: value.slice(0, slashIndex),
    slug: value.slice(slashIndex + 1),
  };
}
