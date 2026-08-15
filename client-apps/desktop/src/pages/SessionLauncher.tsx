import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  NewSessionViewer,
  useAccountExecutionDefaults,
  useEditSessionPrep,
  useActiveOrgSlug,
  useWorkspaceSources,
  CREATOR_AGENTS,
  parseDraftParams,
} from "@stigmer/react";
import type { DraftResourceType } from "@stigmer/react";
import type { ResourceRef } from "@stigmer/sdk";
import { useNativeFolderPicker } from "../hooks/useNativeFolderPicker";
import { useNativeWorkspaceFiles } from "../hooks/useNativeWorkspaceFiles";
import { useNativeWorkspaceFileReader } from "../hooks/useNativeWorkspaceFileReader";
import { useNativeWorkspaceContentSearcher } from "../hooks/useNativeWorkspaceContentSearcher";

const DRAFT_PLACEHOLDERS: Record<DraftResourceType, string> = {
  agent:
    "Describe the agent you\u2019d like to build \u2014 its purpose, the skills " +
    "and MCP servers it should use, and any system instructions to " +
    "guide its behavior.",
  skill:
    "Describe the skill you\u2019d like to build \u2014 what it does and " +
    "what instructions it should follow. You can attach a workspace " +
    "or reference files for additional context.",
  "mcp-server":
    "Describe the MCP server you\u2019d like to register \u2014 its name, " +
    "connection type (stdio or SSE), startup command or endpoint URL, " +
    "and any required environment variables.",
};

const DRAFT_HEADINGS: Record<DraftResourceType, string> = {
  agent: "Add an Agent",
  skill: "Add a Skill",
  "mcp-server": "Add an MCP Server",
};

const EDIT_PLACEHOLDERS: Record<DraftResourceType, string> = {
  agent: "Describe how you\u2019d like to modify this agent\u2026",
  skill: "Describe how you\u2019d like to modify this skill\u2026",
  "mcp-server": "Describe how you\u2019d like to modify this MCP server\u2026",
};

export function SessionLauncher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const org = useActiveOrgSlug();
  // Local mode has no IdentityAccount, so this resolves to undefined on a
  // pure-local desktop — wired anyway for DD-016 parity with web, and it
  // activates automatically when the desktop points at a cloud backend.
  const accountDefaults = useAccountExecutionDefaults();
  const browseLocalFolder = useNativeFolderPicker();
  const { enableGitHub, enableLocal } = useWorkspaceSources({ hasLocalPicker: true });
  const workspaceFileLister = useNativeWorkspaceFiles();
  const workspaceFileReader = useNativeWorkspaceFileReader();
  const workspaceContentSearcher = useNativeWorkspaceContentSearcher();

  // -------------------------------------------------------------------------
  // Draft param capture
  // -------------------------------------------------------------------------

  const draftParams = parseDraftParams(searchParams);
  const liveDraftType = draftParams?.draftType ?? null;
  const liveEditRef = draftParams?.editRef ?? null;

  const [capturedDraftType, setCapturedDraftType] = useState<DraftResourceType | null>(
    () => liveDraftType,
  );
  const [capturedEditRef, setCapturedEditRef] = useState(liveEditRef);
  const draftCaptured = useRef(liveDraftType !== null);

  useEffect(() => {
    if (!draftCaptured.current && liveDraftType) {
      draftCaptured.current = true;
      setCapturedDraftType(liveDraftType);
      setCapturedEditRef(liveEditRef);
    }
  }, [liveDraftType, liveEditRef]);

  const draftType = capturedDraftType;
  const editRef = capturedEditRef ?? null;
  const isEditMode = editRef !== null;

  // -------------------------------------------------------------------------
  // Explicit agent + instance capture ("Start session" from a specific agent
  // instance). Captured once so the URL can be cleaned without losing intent.
  // -------------------------------------------------------------------------

  const liveAgentParam = searchParams.get("agent");
  const liveInstanceParam = searchParams.get("instance");

  const [capturedAgentRef, setCapturedAgentRef] = useState<ResourceRef | undefined>(
    () => parseAgentParam(liveAgentParam),
  );
  const [capturedInstanceId, setCapturedInstanceId] = useState<string | undefined>(
    () => liveInstanceParam ?? undefined,
  );
  const agentParamCaptured = useRef(liveAgentParam !== null);

  useEffect(() => {
    if (!agentParamCaptured.current && liveAgentParam) {
      agentParamCaptured.current = true;
      setCapturedAgentRef(parseAgentParam(liveAgentParam));
      setCapturedInstanceId(liveInstanceParam ?? undefined);
    }
  }, [liveAgentParam, liveInstanceParam]);

  const [initialAgentRef, setInitialAgentRef] = useState<ResourceRef | undefined>(
    () => (draftType ? CREATOR_AGENTS[draftType] : parseAgentParam(liveAgentParam)),
  );
  const initialAgentCaptured = useRef(draftType !== null || liveAgentParam !== null);

  useEffect(() => {
    if (!initialAgentCaptured.current && (draftType || capturedAgentRef)) {
      initialAgentCaptured.current = true;
      setInitialAgentRef(draftType ? CREATOR_AGENTS[draftType] : capturedAgentRef);
    }
  }, [draftType, capturedAgentRef]);

  useEffect(() => {
    if (liveDraftType || liveAgentParam) {
      setSearchParams({}, { replace: true });
    }
  }, [liveDraftType, liveAgentParam, setSearchParams]);

  // -------------------------------------------------------------------------
  // Edit prep
  // -------------------------------------------------------------------------

  const editPrep = useEditSessionPrep(draftType, editRef);

  useEffect(() => {
    if (editPrep.error) toast.error(editPrep.error);
  }, [editPrep.error]);

  // -------------------------------------------------------------------------
  // Derived UI state
  // -------------------------------------------------------------------------

  const placeholder = draftType
    ? isEditMode
      ? EDIT_PLACEHOLDERS[draftType]
      : DRAFT_PLACEHOLDERS[draftType]
    : undefined;

  const heading = isEditMode
    ? "What would you like to change?"
    : draftType
      ? DRAFT_HEADINGS[draftType]
      : undefined;

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
      initialInstanceId={capturedInstanceId}
      initialAttachments={editPrep.files}
      heading={heading}
      placeholder={placeholder}
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
