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
} from "@stigmer/react";
import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { useDeploymentMode } from "@/hooks/useDeploymentMode";

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

export function SessionLauncher() {
  const router = useRouter();
  const org = useActiveOrgSlug();
  const deploymentMode = useDeploymentMode();
  const gitHubConnection = useGitHubConnection(org);

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
  const [agentInstanceId, setAgentInstanceId] = useState<string | null>(null);
  const [mcpServerUsages, setMcpServerUsages] = useState<McpServerUsageInput[]>([]);
  const [skillRefs, setSkillRefs] = useState<ResourceRef[]>([]);
  const { create: createSession } = useCreateSession();
  const { create: createExecution } = useCreateAgentExecution();

  const handleSubmit = useCallback(
    async (message: string, selectedModel?: string) => {
      if (isSubmitting) return;

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const { sessionId } = await createSession({
          org,
          subject: message.slice(0, 120),
          workspaceEntries: workspace.hasEntries
            ? workspace.toInput()
            : undefined,
          mcpServerUsages: mcpServerUsages.length > 0 ? mcpServerUsages : undefined,
          skillRefs: skillRefs.length > 0 ? skillRefs : undefined,
          agentInstanceId: agentInstanceId ?? undefined,
          agentRef: agentRef ?? undefined,
        });

        await createExecution({
          org,
          sessionId,
          message,
          modelName: selectedModel ?? validModelId,
        });

        router.push(`/sessions/${sessionId}`);
      } catch (err) {
        const detail =
          err instanceof Error ? err.message : "Failed to start session";
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
      agentInstanceId,
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
          onAgentInstanceIdChange={setAgentInstanceId}
          mcpServerUsages={mcpServerUsages}
          onMcpServerUsagesChange={setMcpServerUsages}
          skillRefs={skillRefs}
          onSkillRefsChange={setSkillRefs}
          defaultModelId={validModelId}
          onModelChange={setModelId}
          placeholder="Describe what you need help with..."
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
