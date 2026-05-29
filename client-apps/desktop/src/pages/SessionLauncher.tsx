import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  NewSessionViewer,
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
  const browseLocalFolder = useNativeFolderPicker();
  const { enableGitHub, enableLocal } = useWorkspaceSources({ hasLocalPicker: true });
  const workspaceFileLister = useNativeWorkspaceFiles();

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

  const [initialAgentRef, setInitialAgentRef] = useState<ResourceRef | undefined>(
    () => (draftType ? CREATOR_AGENTS[draftType] : undefined),
  );
  const initialAgentCaptured = useRef(draftType !== null);

  useEffect(() => {
    if (!initialAgentCaptured.current && draftType) {
      initialAgentCaptured.current = true;
      setInitialAgentRef(CREATOR_AGENTS[draftType]);
    }
  }, [draftType]);

  useEffect(() => {
    if (liveDraftType) {
      setSearchParams({}, { replace: true });
    }
  }, [liveDraftType, setSearchParams]);

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
      enableGitHub={enableGitHub}
      enableLocal={enableLocal}
      onBrowseLocalFolder={browseLocalFolder}
      workspaceFileLister={workspaceFileLister}
      initialAgentRef={initialAgentRef}
      initialAttachments={editPrep.files}
      heading={heading}
      placeholder={placeholder}
      className="h-full"
    />
  );
}
