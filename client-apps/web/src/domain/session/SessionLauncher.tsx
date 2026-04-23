"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  SessionComposer,
  useModelRegistry,
  useWorkspaceEntries,
  useCreateSession,
  useCreateAgentExecution,
  useGitHubConnection,
  useDefaultAgent,
  useAgent,
  useMcpServer,
  useSkill,
  useStigmer,
  useSessionVariables,
  serializeAgentYaml,
  serializeMcpServerYaml,
} from "@stigmer/react";
import type { AgentResolution, SessionComposerSubmitContext } from "@stigmer/react";
import { getUserMessage, type McpServerUsageInput, type ResourceRef } from "@stigmer/sdk";
import { create } from "@bufbuild/protobuf";
import { GetArtifactRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { useActiveOrgSlug } from "@/domain/_shared/org/org-context";
import { useDeploymentMode } from "@/domain/_shared/hooks/useDeploymentMode";
import {
  CREATOR_AGENTS,
  parseDraftParams,
  type DraftResourceType,
} from "@/domain/session/draft-session";
import { useSessionNavigation } from "@/domain/session/session-navigation";

/**
 * Console-specific session launcher — the landing page widget that
 * composes SDK hooks and components into the "new session" experience.
 *
 * Flow: create session -> create first execution -> navigate.
 *
 * Supports two modes:
 * - **Create mode**: `/?draft=agent` — pre-selects the creator agent
 * - **Edit mode**: `/?draft=agent&editOrg=acme&editSlug=my-agent` —
 *   fetches the existing resource, serializes it to a file, and attaches
 *   it to the composer so the creator agent can modify it
 *
 * Adds org context, Next.js routing, Console layout, GitHub connection,
 * and deployment mode detection that would not belong in an embeddable
 * SDK component.
 */
const STORAGE_KEY_MODEL = "stigmer:session:model";

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
  const rawSearchParams = useSearchParams();
  const draftParams = parseDraftParams(rawSearchParams);
  const org = useActiveOrgSlug();
  const deploymentMode = useDeploymentMode();
  const gitHubConnection = useGitHubConnection(org);
  const stigmer = useStigmer();
  const { navigateToSession } = useSessionNavigation();

  const liveDraftType = draftParams?.draftType ?? null;
  const liveEditRef = draftParams?.editRef ?? null;

  // Capture draft params in state so they survive URL cleanup.
  // useState initializer handles the fast path (params available on first
  // render). The effect handles the deferred path: in Next.js static
  // export, useSearchParams() may not have the params until after
  // hydration completes.
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
  const editRef = capturedEditRef;
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

  // Clean URL params after capturing
  useEffect(() => {
    if (liveDraftType) {
      window.history.replaceState({}, "", "/");
    }
  }, [liveDraftType]);

  // ---------------------------------------------------------------------------
  // Edit mode: fetch resource and build initial attachment files
  // ---------------------------------------------------------------------------

  const editOrg = editRef?.org ?? null;
  const editSlug = editRef?.slug ?? null;

  const { agent: editAgent } = useAgent(
    draftType === "agent" ? editOrg : null,
    draftType === "agent" ? editSlug : null,
  );

  const { mcpServer: editMcpServer } = useMcpServer(
    draftType === "mcp-server" ? editOrg : null,
    draftType === "mcp-server" ? editSlug : null,
  );

  const { skill: editSkill } = useSkill(
    draftType === "skill" ? editOrg : null,
    draftType === "skill" ? editSlug : null,
  );

  const [editFiles, setEditFiles] = useState<File[] | undefined>(undefined);
  const editFilesBuilt = useRef(false);

  // Agent / McpServer: serialize to YAML file
  useEffect(() => {
    if (editFilesBuilt.current) return;

    if (draftType === "agent" && editAgent) {
      editFilesBuilt.current = true;
      try {
        const yaml = serializeAgentYaml(editAgent);
        const slug = editAgent.metadata?.slug ?? "agent";
        setEditFiles([
          new File([yaml], `${slug}.yaml`, { type: "text/yaml" }),
        ]);
      } catch {
        toast.error("Failed to serialize agent for editing");
      }
    }

    if (draftType === "mcp-server" && editMcpServer) {
      editFilesBuilt.current = true;
      try {
        const yaml = serializeMcpServerYaml(editMcpServer);
        const slug = editMcpServer.metadata?.slug ?? "mcp-server";
        setEditFiles([
          new File([yaml], `${slug}.yaml`, { type: "text/yaml" }),
        ]);
      } catch {
        toast.error("Failed to serialize MCP server for editing");
      }
    }
  }, [draftType, editAgent, editMcpServer]);

  // Skill: download the package ZIP
  useEffect(() => {
    if (editFilesBuilt.current) return;
    if (draftType !== "skill" || !editSkill) return;

    const storageKey = editSkill.status?.artifactStorageKey;
    if (!storageKey) return;

    editFilesBuilt.current = true;
    const slug = editSkill.metadata?.slug ?? "skill";

    stigmer.skill
      .getArtifact(create(GetArtifactRequestSchema, { artifactStorageKey: storageKey }))
      .then((resp) => {
        const buf = new ArrayBuffer(resp.artifact.byteLength);
        new Uint8Array(buf).set(resp.artifact);
        const blob = new Blob([buf], { type: "application/zip" });
        setEditFiles([
          new File([blob], `${slug}.zip`, { type: "application/zip" }),
        ]);
      })
      .catch(() => {
        toast.error("Failed to download skill package for editing");
      });
  }, [draftType, editSkill, stigmer]);

  // ---------------------------------------------------------------------------
  // Model persistence
  // ---------------------------------------------------------------------------

  const { getModel } = useModelRegistry();

  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validModelId = modelId && getModel(modelId) ? modelId : undefined;

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY_MODEL);
    if (stored && getModel(stored)) {
      setModelId(stored);
    }
  }, [getModel]);

  useEffect(() => {
    if (modelId) {
      localStorage.setItem(STORAGE_KEY_MODEL, modelId);
    }
  }, [modelId]);

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------

  const workspace = useWorkspaceEntries();
  const sessionVariables = useSessionVariables();
  const [agentRef, setAgentRef] = useState<ResourceRef | null>(null);
  const [resolution, setResolution] = useState<AgentResolution | null>(null);
  const [mcpServerUsages, setMcpServerUsages] = useState<McpServerUsageInput[]>([]);
  const [skillRefs, setSkillRefs] = useState<ResourceRef[]>([]);
  const [runnerId, setRunnerId] = useState<string | null>(null);
  const { create: createSession } = useCreateSession();
  const { create: createExecution } = useCreateAgentExecution();
  const { agent: defaultAgent } = useDefaultAgent(org);

  const handleSubmit = useCallback(
    async (
      message: string,
      selectedModel?: string,
      context?: SessionComposerSubmitContext,
    ) => {
      if (isSubmitting) return;
      if (!org) {
        setSubmitError("Select an organization before starting a session.");
        toast.error("Select an organization before starting a session.");
        return;
      }

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const sessionFields = {
          org,
          workspaceEntries: workspace.hasEntries
            ? workspace.toInput()
            : undefined,
          mcpServerUsages: mcpServerUsages.length > 0 ? mcpServerUsages : undefined,
          skillRefs: skillRefs.length > 0 ? skillRefs : undefined,
          runnerId: runnerId ?? undefined,
        };

        const executionFields = {
          org,
          message,
          modelName: selectedModel ?? validModelId,
          runtimeEnv: context?.runtimeEnv,
          attachments: context?.attachments,
        };

        let sessionId: string;

        if (agentRef && resolution) {
          if (resolution.mode === "saved") {
            ({ sessionId } = await createSession({
              ...sessionFields,
              agentInstanceId: resolution.instanceId,
            }));
          } else {
            ({ sessionId } = await createSession({
              ...sessionFields,
              agentRef,
            }));
          }
        } else {
          const defaultInstanceId = defaultAgent?.status?.defaultInstanceId;
          if (!defaultInstanceId) {
            throw new Error(
              "No default agent available. Select an agent to start a session.",
            );
          }
          ({ sessionId } = await createSession({
            ...sessionFields,
            agentInstanceId: defaultInstanceId,
          }));
        }

        await createExecution({ ...executionFields, sessionId });
        sessionVariables.clear();
        navigateToSession(sessionId);
      } catch (err) {
        const detail = getUserMessage(err, "Failed to start session");
        setSubmitError(detail);
        toast.error(detail);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      isSubmitting,
      org,
      validModelId,
      workspace,
      mcpServerUsages,
      skillRefs,
      runnerId,
      agentRef,
      resolution,
      defaultAgent,
      createSession,
      createExecution,
      sessionVariables,
      navigateToSession,
    ],
  );

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-4">
      <div className="my-auto w-full max-w-2xl space-y-6">
        <h1 className="text-center text-lg font-medium text-foreground">
          {heading}
        </h1>

        <SessionComposer
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          org={org}
          workspace={workspace}
          gitHubConnection={gitHubConnection}
          enableGitHub
          enableLocal={deploymentMode === "local"}
          agentRef={agentRef}
          onAgentRefChange={setAgentRef}
          onAgentResolutionChange={setResolution}
          initialAgentRef={initialAgentRef}
          initialAttachments={editFiles}
          mcpServerUsages={mcpServerUsages}
          onMcpServerUsagesChange={setMcpServerUsages}
          skillRefs={skillRefs}
          onSkillRefsChange={setSkillRefs}
          runnerId={runnerId}
          onRunnerIdChange={setRunnerId}
          sessionVariables={sessionVariables}
          defaultModelId={validModelId}
          onModelChange={setModelId}
          placeholder={placeholder}
          initialRows={3}
          autoFocus
          ariaLabel="Start a new session"
        />

        {submitError && (
          <p className="text-xs text-destructive" role="alert">
            {submitError}
          </p>
        )}

        <p className="text-center text-[0.65rem] text-muted-foreground">
          Press Enter to send, Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
