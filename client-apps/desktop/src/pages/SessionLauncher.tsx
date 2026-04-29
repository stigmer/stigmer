import { useEffect, useRef, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  SessionComposer,
  useNewSessionFlow,
  useEditSessionPrep,
  useActiveOrgSlug,
  CREATOR_AGENTS,
  parseDraftParams,
} from "@stigmer/react";
import type { DraftResourceType } from "@stigmer/react";
import type { ResourceRef } from "@stigmer/sdk";
import { useNativeFolderPicker } from "../hooks/useNativeFolderPicker";
import { useDesktopGitHubConnection } from "../hooks/useDesktopGitHubConnection";

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
  const gitHubConnection = useDesktopGitHubConnection(org);
  const browseLocalFolder = useNativeFolderPicker();

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

  const flow = useNewSessionFlow({
    org,
    onSessionCreated: (id) => navigate(`/sessions/${id}`),
    onError: (msg) => toast.error(msg),
  });

  const editPrep = useEditSessionPrep(draftType, editRef);

  useEffect(() => {
    if (editPrep.error) toast.error(editPrep.error);
  }, [editPrep.error]);

  const placeholder = draftType
    ? isEditMode
      ? EDIT_PLACEHOLDERS[draftType]
      : DRAFT_PLACEHOLDERS[draftType]
    : "Describe what you need help with\u2026";

  const heading = isEditMode
    ? "What would you like to change?"
    : draftType
      ? DRAFT_HEADINGS[draftType]
      : "What would you like to work on?";

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-4">
      <div className="my-auto w-full max-w-2xl space-y-6">
        <h1 className="text-center text-lg font-medium text-foreground">
          {heading}
        </h1>

        <SessionComposer
          onSubmit={flow.submit}
          isSubmitting={flow.isSubmitting}
          org={org}
          workspace={flow.workspace}
          gitHubConnection={gitHubConnection}
          enableGitHub
          enableLocal
          onBrowseLocalFolder={browseLocalFolder}
          agentRef={flow.agentRef}
          onAgentRefChange={flow.setAgentRef}
          onAgentResolutionChange={flow.setResolution}
          initialAgentRef={initialAgentRef}
          initialAttachments={editPrep.files}
          mcpServerUsages={flow.mcpServerUsages}
          onMcpServerUsagesChange={flow.setMcpServerUsages}
          skillRefs={flow.skillRefs}
          onSkillRefsChange={flow.setSkillRefs}
          runnerId={flow.runnerId}
          onRunnerIdChange={flow.setRunnerId}
          sessionVariables={flow.sessionVariables}
          defaultModelId={flow.modelId}
          onModelChange={flow.setModelId}
          placeholder={placeholder}
          initialRows={3}
          autoFocus
          ariaLabel="Start a new session"
        />

        {flow.submitError && (
          <p className="text-xs text-destructive" role="alert">
            {flow.submitError}
          </p>
        )}

        <p className="text-center text-[0.65rem] text-muted-foreground">
          Press Enter to send, Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
