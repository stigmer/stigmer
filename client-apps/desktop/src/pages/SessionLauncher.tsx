import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  NewSessionViewer,
  useAccountExecutionDefaults,
  useWorkspaceSources,
  useActiveOrgId,
} from "@stigmer/react";
import type { ResourceRef } from "@stigmer/sdk";
import { useNativeFolderPicker } from "../hooks/useNativeFolderPicker";
import { useNativeWorkspaceFiles } from "../hooks/useNativeWorkspaceFiles";
import { useNativeWorkspaceFileReader } from "../hooks/useNativeWorkspaceFileReader";
import { useNativeWorkspaceContentSearcher } from "../hooks/useNativeWorkspaceContentSearcher";

/**
 * Desktop session launcher — thin shell that composes the SDK
 * `NewSessionViewer` with router navigation, org context, the native
 * workspace hooks, the `?agent=org/slug` URL parameter a "Start session"
 * action arrives with, and the `?plugin=org/slug` one a plugin's "Start a
 * chat" arrives with. The person's plugin picks are remembered on this
 * machine for the next conversation, as the web console remembers them.
 */
export function SessionLauncher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const org = useActiveOrgId();
  // The account's saved execution defaults seed the launcher (parity
  // with web). Every edition serves the account: a local desktop reads the
  // operator account its embedded server creates at boot.
  const accountDefaults = useAccountExecutionDefaults();
  const browseLocalFolder = useNativeFolderPicker();
  const { enableGitHub, enableLocal } = useWorkspaceSources({ hasLocalPicker: true });
  const workspaceFileLister = useNativeWorkspaceFiles();
  const workspaceFileReader = useNativeWorkspaceFileReader();
  const workspaceContentSearcher = useNativeWorkspaceContentSearcher();

  // -------------------------------------------------------------------------
  // Explicit agent capture ("Start session" from an agent). Captured once so
  // the URL can be cleaned without losing intent.
  // -------------------------------------------------------------------------

  const liveAgentParam = searchParams.get("agent");
  const livePluginParam = searchParams.get("plugin");

  const [initialAgentRef, setInitialAgentRef] = useState<ResourceRef | undefined>(
    () => parseRefParam(liveAgentParam),
  );
  const agentParamCaptured = useRef(liveAgentParam !== null);
  const [initialPluginRef, setInitialPluginRef] = useState<ResourceRef | undefined>(
    () => parseRefParam(livePluginParam),
  );
  const pluginParamCaptured = useRef(livePluginParam !== null);

  useEffect(() => {
    if (!agentParamCaptured.current && liveAgentParam) {
      agentParamCaptured.current = true;
      setInitialAgentRef(parseRefParam(liveAgentParam));
    }
  }, [liveAgentParam]);

  useEffect(() => {
    if (!pluginParamCaptured.current && livePluginParam) {
      pluginParamCaptured.current = true;
      setInitialPluginRef(parseRefParam(livePluginParam));
    }
  }, [livePluginParam]);

  useEffect(() => {
    if (liveAgentParam || livePluginParam) {
      setSearchParams({}, { replace: true });
    }
  }, [liveAgentParam, livePluginParam, setSearchParams]);

  return (
    <NewSessionViewer
      org={org}
      onSessionCreated={(id) => navigate(`/sessions/${id}`)}
      onError={(msg) => toast.error(msg)}
      accountDefaults={accountDefaults}
      enableGitHub={enableGitHub}
      enableLocal={enableLocal}
      onBrowseLocalFolder={browseLocalFolder}
      workspaceFileLister={workspaceFileLister}
      workspaceFileReader={workspaceFileReader}
      workspaceContentSearcher={workspaceContentSearcher}
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
