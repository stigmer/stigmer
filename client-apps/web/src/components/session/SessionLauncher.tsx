"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  SessionComposer,
  useModelRegistry,
  useWorkspaceEntries,
  useCreateSession,
  useCreateAgentExecution,
  useGitHubConnection,
  useDefaultAgent,
} from "@stigmer/react";
import type { AgentResolution, SessionComposerSubmitContext } from "@stigmer/react";
import { getUserMessage, type McpServerUsageInput, type ResourceRef } from "@stigmer/sdk";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { useDeploymentMode } from "@/hooks/useDeploymentMode";
import { CREATOR_AGENTS, type DraftResourceType } from "@/utils/draft-session";

/**
 * Console-specific session launcher — the landing page widget that
 * composes SDK hooks and components into the "new session" experience.
 *
 * Flow: create session -> create first execution -> navigate.
 *
 * Adds org context, Next.js routing, Console layout, GitHub connection,
 * and deployment mode detection that would not belong in an embeddable
 * SDK component.
 */
const STORAGE_KEY_MODEL = "stigmer:session:model";

const DRAFT_PLACEHOLDERS: Record<DraftResourceType, string> = {
  agent: "Describe the agent you want to create\u2026",
  skill: "Describe the skill you want to create\u2026",
  "mcp-server": "Describe the MCP server you want to create\u2026",
};

interface SessionLauncherProps {
  draftType?: DraftResourceType | null;
}

export function SessionLauncher({ draftType }: SessionLauncherProps) {
  const router = useRouter();
  const org = useActiveOrgSlug();
  const deploymentMode = useDeploymentMode();
  const gitHubConnection = useGitHubConnection(org);

  const initialAgentRef = draftType ? CREATOR_AGENTS[draftType] : undefined;
  const placeholder = draftType
    ? DRAFT_PLACEHOLDERS[draftType]
    : "Describe what you need help with\u2026";

  useEffect(() => {
    if (draftType) {
      window.history.replaceState({}, "", "/");
    }
  }, [draftType]);

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

  const workspace = useWorkspaceEntries();
  const [agentRef, setAgentRef] = useState<ResourceRef | null>(null);
  const [resolution, setResolution] = useState<AgentResolution | null>(null);
  const [mcpServerUsages, setMcpServerUsages] = useState<McpServerUsageInput[]>([]);
  const [skillRefs, setSkillRefs] = useState<ResourceRef[]>([]);
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

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const sessionFields = {
          org,
          subject: message.slice(0, 120),
          workspaceEntries: workspace.hasEntries
            ? workspace.toInput()
            : undefined,
          mcpServerUsages: mcpServerUsages.length > 0 ? mcpServerUsages : undefined,
          skillRefs: skillRefs.length > 0 ? skillRefs : undefined,
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
          // User explicitly selected an agent — use their choice
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
          // No agent selected — use platform default agent silently
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
        router.push(`/sessions/${sessionId}`);
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
      agentRef,
      resolution,
      defaultAgent,
      createSession,
      createExecution,
      router,
    ],
  );

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-4">
      <div className="my-auto w-full max-w-2xl space-y-6">
        <h1 className="text-center text-lg font-medium text-foreground">
          What would you like to work on?
        </h1>

        <SessionComposer
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          org={org}
          workspace={workspace}
          gitHubConnection={gitHubConnection}
          enableGitHub
          enableLocal={deploymentMode === "local"}
          enableFolderBrowser={deploymentMode === "local"}
          agentRef={agentRef}
          onAgentRefChange={setAgentRef}
          onAgentResolutionChange={setResolution}
          initialAgentRef={initialAgentRef}
          mcpServerUsages={mcpServerUsages}
          onMcpServerUsagesChange={setMcpServerUsages}
          skillRefs={skillRefs}
          onSkillRefsChange={setSkillRefs}
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
