"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  NewSessionViewer,
  useEditSessionPrep,
  useGitHubConnection,
  useWorkspaceSources,
  CREATOR_AGENTS,
  parseDraftParams,
  useActiveOrgSlug,
} from "@stigmer/react";
import type { DraftResourceType } from "@stigmer/react";
import type { ResourceRef } from "@stigmer/sdk";
import { useSessionNavigation } from "@/domain/session/session-navigation";

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

/**
 * Console-specific session launcher — thin shell that composes the SDK
 * `NewSessionViewer` with Console routing, org context, and draft-mode
 * URL parameters.
 */
export function SessionLauncher() {
  const rawSearchParams = useSearchParams();
  const draftParams = parseDraftParams(rawSearchParams);
  const org = useActiveOrgSlug();
  const gitHubConnection = useGitHubConnection(org);
  const { enableGitHub, enableLocal } = useWorkspaceSources();
  const { navigateToSession } = useSessionNavigation();

  // -------------------------------------------------------------------------
  // Draft param capture (survives URL cleanup + Next.js hydration delay)
  // -------------------------------------------------------------------------

  const liveDraftType = draftParams?.draftType ?? null;
  const liveEditRef = draftParams?.editRef ?? null;

  const [capturedDraftType, setCapturedDraftType] = useState<DraftResourceType | null>(
    () => liveDraftType,
  );
  const [capturedEditRef, setCapturedEditRef] = useState(liveEditRef);

  if (capturedDraftType === null && liveDraftType) {
    setCapturedDraftType(liveDraftType);
    setCapturedEditRef(liveEditRef);
  }

  const draftType = capturedDraftType;
  const editRef = capturedEditRef ?? null;
  const isEditMode = editRef !== null;

  const [initialAgentRef, setInitialAgentRef] = useState<ResourceRef | undefined>(
    () => (draftType ? CREATOR_AGENTS[draftType] : undefined),
  );

  if (initialAgentRef === undefined && draftType) {
    setInitialAgentRef(CREATOR_AGENTS[draftType]);
  }

  useEffect(() => {
    if (liveDraftType) {
      window.history.replaceState({}, "", "/");
    }
  }, [liveDraftType]);

  // -------------------------------------------------------------------------
  // Edit prep
  // -------------------------------------------------------------------------

  const editPrep = useEditSessionPrep(draftType, editRef);

  useEffect(() => {
    if (editPrep.error) {
      toast.error(editPrep.error);
    }
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
      onSessionCreated={navigateToSession}
      onError={(msg) => toast.error(msg)}
      gitHubConnection={enableGitHub ? gitHubConnection : undefined}
      enableGitHub={enableGitHub}
      enableLocal={enableLocal}
      initialAgentRef={initialAgentRef}
      initialAttachments={editPrep.files}
      heading={heading}
      placeholder={placeholder}
      className="h-full"
    />
  );
}
