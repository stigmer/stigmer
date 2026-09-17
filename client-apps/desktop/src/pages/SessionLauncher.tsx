import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  NewSessionViewer,
  useAccountExecutionDefaults,
  useActiveOrgSlug,
  useWorkspaceSources,
} from "@stigmer/react";
import type { ResourceRef } from "@stigmer/sdk";
import { useNativeFolderPicker } from "../hooks/useNativeFolderPicker";
import { useNativeWorkspaceFiles } from "../hooks/useNativeWorkspaceFiles";
import { useNativeWorkspaceFileReader } from "../hooks/useNativeWorkspaceFileReader";
import { useNativeWorkspaceContentSearcher } from "../hooks/useNativeWorkspaceContentSearcher";

/**
 * Desktop session launcher — thin shell that composes the SDK
 * `NewSessionViewer` with router navigation, org context, the native
 * workspace hooks, and the `?agent=org/slug[&instance=id]` URL parameters a
 * "Start session" action arrives with.
 */
export function SessionLauncher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const org = useActiveOrgSlug();
  // The account's saved execution defaults seed the launcher (DD-016 parity
  // with web). Every edition serves the account: a local desktop reads the
  // operator account its embedded server creates at boot.
  const accountDefaults = useAccountExecutionDefaults();
  const browseLocalFolder = useNativeFolderPicker();
  const { enableGitHub, enableLocal } = useWorkspaceSources({ hasLocalPicker: true });
  const workspaceFileLister = useNativeWorkspaceFiles();
  const workspaceFileReader = useNativeWorkspaceFileReader();
  const workspaceContentSearcher = useNativeWorkspaceContentSearcher();

  // -------------------------------------------------------------------------
  // Explicit agent + instance capture ("Start session" from a specific agent
  // instance). Captured once so the URL can be cleaned without losing intent.
  // -------------------------------------------------------------------------

  const liveAgentParam = searchParams.get("agent");
  const liveInstanceParam = searchParams.get("instance");

  const [initialAgentRef, setInitialAgentRef] = useState<ResourceRef | undefined>(
    () => parseAgentParam(liveAgentParam),
  );
  const [initialInstanceId, setInitialInstanceId] = useState<string | undefined>(
    () => liveInstanceParam ?? undefined,
  );
  const agentParamCaptured = useRef(liveAgentParam !== null);

  useEffect(() => {
    if (!agentParamCaptured.current && liveAgentParam) {
      agentParamCaptured.current = true;
      setInitialAgentRef(parseAgentParam(liveAgentParam));
      setInitialInstanceId(liveInstanceParam ?? undefined);
    }
  }, [liveAgentParam, liveInstanceParam]);

  useEffect(() => {
    if (liveAgentParam) {
      setSearchParams({}, { replace: true });
    }
  }, [liveAgentParam, setSearchParams]);

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
      initialInstanceId={initialInstanceId}
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
