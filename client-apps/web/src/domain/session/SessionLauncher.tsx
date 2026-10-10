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
 * `NewSessionViewer` with Console routing, org context, the
 * `?agent=org/slug` URL parameter a "Start session" action arrives with,
 * and the `?plugin=org/slug` one a plugin's "Start a chat" arrives with.
 * The person's plugin picks are remembered in this browser for the next
 * conversation.
 */
export function SessionLauncher() {
  const rawSearchParams = useSearchParams();
  const org = useActiveOrgId();
  const accountDefaults = useAccountExecutionDefaults();
  const gitHubConnection = useGitHubConnection(org);
  const { enableGitHub, enableLocal } = useWorkspaceSources();
  const workspaceFileLister = useGitHubTreeLister(gitHubConnection.readOrg);
  const workspaceFileReader = useGitHubFileReader(gitHubConnection.readOrg);
  const { navigateToSession } = useSessionNavigation();

  // -------------------------------------------------------------------------
  // Explicit agent capture ("Start session" from an agent). Captured once so
  // the URL can be cleaned without losing intent.
  // -------------------------------------------------------------------------

  const liveAgentParam = rawSearchParams.get("agent");
  const livePluginParam = rawSearchParams.get("plugin");

  const [initialAgentRef, setInitialAgentRef] = useState<ResourceRef | undefined>(
    () => parseRefParam(liveAgentParam),
  );
  const [initialPluginRef, setInitialPluginRef] = useState<ResourceRef | undefined>(
    () => parseRefParam(livePluginParam),
  );

  if (initialAgentRef === undefined && liveAgentParam) {
    setInitialAgentRef(parseRefParam(liveAgentParam));
  }
  if (initialPluginRef === undefined && livePluginParam) {
    setInitialPluginRef(parseRefParam(livePluginParam));
  }

  useEffect(() => {
    if (liveAgentParam || livePluginParam) {
      window.history.replaceState({}, "", "/");
    }
  }, [liveAgentParam, livePluginParam]);

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
      initialPluginRefs={initialPluginRef ? [initialPluginRef] : undefined}
      rememberPluginPicks
      className="h-full"
    />
  );
}

/**
 * Parse an `agent` or `plugin` query param of the form `org/slug` into a
 * {@link ResourceRef}. Returns `undefined` when absent or malformed.
 */
function parseRefParam(value: string | null): ResourceRef | undefined {
  if (!value) return undefined;
  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0 || slashIndex === value.length - 1) return undefined;
  return {
    org: value.slice(0, slashIndex),
    slug: value.slice(slashIndex + 1),
  };
}
