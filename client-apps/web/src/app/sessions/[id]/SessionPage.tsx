"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Loader2,
  RotateCcw,
  WifiOff,
} from "lucide-react";
import {
  useSessionConversation,
  useAgentRefFromSession,
  useDefaultAgent,
  useModelRegistry,
  useWorkspaceEntries,
  useGitHubConnection,
  useSessionVariables,
  useStigmer,
  MessageThread,
  SessionComposer,
  ExecutionProgress,
  UsageWidget,
  ArtifactsWidget,
  WriteBacksWidget,
  SecretFlowErrorGuide,
  isSecretFlowError,
} from "@stigmer/react";
import type { AgentResolution, SessionComposerSubmitContext } from "@stigmer/react";
import { getUserMessage, type McpServerUsageInput, type ResourceRef } from "@stigmer/sdk";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { useDeploymentMode } from "@/hooks/useDeploymentMode";
import { useStaticRouteParam } from "@/hooks/useStaticRouteParam";
import { Button } from "@/components/ui/button";

const STORAGE_KEY_MODEL = "stigmer:session:model";

/**
 * Well-known Daytona sandbox workspace root. Used as the SDK safety-net
 * normalization target for cloud sessions (git-repo workspace entries).
 * Matches `DAYTONA_WORKSPACE_MOUNT_PATH` in the backend.
 */
const DAYTONA_WORKSPACE_ROOT = "/home/daytona/workspace";

function usePersistedModel() {
  const { getModel } = useModelRegistry();

  const [modelId, setModelId] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    return localStorage.getItem(STORAGE_KEY_MODEL) ?? undefined;
  });

  useEffect(() => {
    if (modelId) {
      localStorage.setItem(STORAGE_KEY_MODEL, modelId);
    }
  }, [modelId]);

  const validModelId = modelId && getModel(modelId) ? modelId : undefined;
  return [validModelId, setModelId] as const;
}

export default function SessionPage() {
  const id = useStaticRouteParam("id");
  if (!id) return <SessionSkeleton />;
  return <SessionPageInner id={id} />;
}

export function SessionPageInner({ id }: { id: string }) {
  const org = useActiveOrgSlug();
  const stigmer = useStigmer();
  const conv = useSessionConversation(id, org);
  const [modelId, setModelId] = usePersistedModel();

  const deploymentMode = useDeploymentMode();
  const gitHubConnection = useGitHubConnection(org);
  const workspace = useWorkspaceEntries();
  const sessionVariables = useSessionVariables();
  const [mcpServerUsages, setMcpServerUsages] = useState<McpServerUsageInput[]>([]);
  const [skillRefs, setSkillRefs] = useState<ResourceRef[]>([]);
  const initialSyncDone = useRef(false);

  // ---------------------------------------------------------------------------
  // Agent — derive current agentRef from session, allow mid-session changes
  // ---------------------------------------------------------------------------

  const sessionInstanceId = conv.session?.spec?.agentInstanceId ?? null;
  const { agentRef: derivedAgentRef } = useAgentRefFromSession(sessionInstanceId);
  const { agent: defaultAgent, isLoading: isDefaultAgentLoading } = useDefaultAgent(org);

  const [agentRef, setAgentRef] = useState<ResourceRef | null>(null);
  const [resolution, setResolution] = useState<AgentResolution | null>(null);
  const [agentInitDone, setAgentInitDone] = useState(false);

  if (!agentInitDone && derivedAgentRef && sessionInstanceId && !isDefaultAgentLoading) {
    setAgentInitDone(true);

    const isDefault =
      defaultAgent &&
      derivedAgentRef.org === defaultAgent.metadata?.org &&
      derivedAgentRef.slug === defaultAgent.metadata?.slug;

    if (!isDefault) {
      setAgentRef(derivedAgentRef);
      setResolution({ mode: "saved", instanceId: sessionInstanceId });
    }
  }

  useEffect(() => {
    if (!conv.session || initialSyncDone.current) return;
    initialSyncDone.current = true;

    const protoEntries = conv.session.spec?.workspaceEntries ?? [];
    for (const entry of protoEntries) {
      if (entry.source?.source.case === "gitRepo") {
        const { url, branch } = entry.source.source.value;
        workspace.addGitRepo(url, branch || undefined);
      } else if (entry.source?.source.case === "localPath") {
        workspace.addLocalPath(entry.source.source.value.path);
      }
    }
  }, [conv.session, workspace]);

  const handleSubmit = useCallback(
    async (
      message: string,
      model?: string,
      context?: SessionComposerSubmitContext,
    ) => {
      let agentInstanceIdOverride: string | undefined;

      if (resolution) {
        if (
          resolution.mode === "saved" &&
          resolution.instanceId !== sessionInstanceId
        ) {
          agentInstanceIdOverride = resolution.instanceId;
        } else if (resolution.mode === "direct" && agentRef) {
          const agent = await stigmer.agent.getByReference(agentRef);
          const defaultId = agent.status?.defaultInstanceId;
          if (defaultId && defaultId !== sessionInstanceId) {
            agentInstanceIdOverride = defaultId;
          }
        }
      }

      conv.sendFollowUp(message, {
        agentInstanceId: agentInstanceIdOverride,
        modelName: model ?? modelId,
        workspaceEntries: workspace.hasEntries
          ? workspace.toInput()
          : undefined,
        mcpServerUsages: mcpServerUsages.length > 0 ? mcpServerUsages : undefined,
        skillRefs: skillRefs.length > 0 ? skillRefs : undefined,
        runtimeEnv: context?.runtimeEnv,
        attachments: context?.attachments,
      });

      sessionVariables.clear();
    },
    [conv, modelId, workspace, mcpServerUsages, skillRefs, sessionVariables, resolution, agentRef, sessionInstanceId, stigmer],
  );

  const displayExecution = useMemo(() => {
    if (conv.activeStreamExecution) return conv.activeStreamExecution;
    const completed = conv.completedExecutions;
    return completed.length > 0 ? completed[completed.length - 1] : null;
  }, [conv.activeStreamExecution, conv.completedExecutions]);

  const sandboxWorkspaceRoot = useMemo(() => {
    const entries = conv.workspaceEntries;
    const hasGitRepo = entries.some(
      (e) => e.source?.source.case === "gitRepo",
    );
    return hasGitRepo ? DAYTONA_WORKSPACE_ROOT : undefined;
  }, [conv.workspaceEntries]);

  if (conv.isLoading) return <SessionSkeleton />;
  if (conv.loadError) return <SessionError error={conv.loadError} />;
  if (!conv.session && !conv.isLoading) return <SessionStarting />;

  return (
    <div className="flex h-full w-full flex-col pl-[220px]">
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageThread
            executions={conv.completedExecutions}
            activeStreamExecution={conv.activeStreamExecution}
            pendingUserMessage={conv.pendingUserMessage}
            onApprovalSubmit={conv.submitApproval}
            submittingApprovalIds={conv.submittingApprovalIds}
            workspaceEntries={conv.workspaceEntries}
            sandboxWorkspaceRoot={sandboxWorkspaceRoot}
            className="flex-1 lg:pr-[208px]"
          />
          <div className="lg:mr-[208px]">
            {conv.streamError && (
              <StreamErrorBanner
                error={conv.streamError}
                onReconnect={conv.reconnectStream}
              />
            )}
            {(conv.sendError || conv.approvalError) && (
              <SendErrorBanner error={(conv.sendError ?? conv.approvalError)!} />
            )}
            <SessionComposer
              onSubmit={handleSubmit}
              isSubmitting={conv.isSending}
              disabled={!conv.canSendFollowUp}
              org={org}
              defaultModelId={modelId}
              onModelChange={setModelId}
              workspace={workspace}
              gitHubConnection={gitHubConnection}
              enableGitHub
              enableLocal={deploymentMode === "local"}
              agentRef={agentRef}
              onAgentRefChange={setAgentRef}
              onAgentResolutionChange={setResolution}
              mcpServerUsages={mcpServerUsages}
              onMcpServerUsagesChange={setMcpServerUsages}
              skillRefs={skillRefs}
              onSkillRefsChange={setSkillRefs}
              sessionVariables={sessionVariables}
              className="px-4 py-3"
            />
          </div>
        </div>
        <aside
          className="hidden w-80 shrink-0 flex-col gap-3 overflow-y-auto py-4 pr-6 lg:flex"
          aria-label="Execution details"
        >
          {displayExecution && (
            <>
              <div className="rounded-lg border border-border bg-card p-3">
                <ExecutionProgress execution={displayExecution} />
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <UsageWidget
                  executions={[
                    ...conv.completedExecutions,
                    ...(conv.activeStreamExecution
                      ? [conv.activeStreamExecution]
                      : []),
                  ]}
                />
              </div>
            </>
          )}
          <WriteBacksWidget
            executions={[
              ...conv.completedExecutions,
              ...(conv.activeStreamExecution
                ? [conv.activeStreamExecution]
                : []),
            ]}
          />
          <ArtifactsWidget
            executions={[
              ...conv.completedExecutions,
              ...(conv.activeStreamExecution
                ? [conv.activeStreamExecution]
                : []),
            ]}
            org={org}
          />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components
// ---------------------------------------------------------------------------

export function SessionSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 p-4" aria-busy="true">
      <div className="animate-pulse space-y-4">
        <div className="rounded-lg bg-muted-subtle px-4 py-3">
          <div className="h-4 w-3/5 rounded bg-muted" />
        </div>

        <div className="space-y-2 px-4">
          <div className="h-4 w-4/5 rounded bg-muted" />
          <div className="h-4 w-3/5 rounded bg-muted" />
          <div className="h-4 w-2/5 rounded bg-muted" />
        </div>

        <div className="mx-4 h-8 w-2/5 rounded-md border border-border bg-muted-subtle" />

        <div className="space-y-2 px-4">
          <div className="h-4 w-3/4 rounded bg-muted" />
          <div className="h-4 w-1/2 rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

function SessionError({ error }: { error: Error }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="bg-destructive-subtle mx-auto flex size-12 items-center justify-center rounded-full">
          <AlertTriangle className="text-destructive size-6" />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Failed to load session</h1>
          <p className="text-muted-foreground text-sm">{getUserMessage(error)}</p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
          >
            <RotateCcw className="mr-1.5 size-3.5" />
            Try again
          </Button>
          <Link
            href="/"
            className="hover:bg-muted hover:text-foreground inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-sm font-medium transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function SessionStarting() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="space-y-2 text-center">
        <Loader2 className="text-muted-foreground mx-auto size-5 animate-spin" />
        <p className="text-muted-foreground text-sm">Starting session…</p>
      </div>
    </div>
  );
}

function SendErrorBanner({ error }: { error: Error }) {
  if (isSecretFlowError(error)) {
    return <SecretFlowErrorGuide error={error} className="mx-4 my-2" />;
  }
  return (
    <div
      role="alert"
      className="border-border border-t px-4 py-2 text-xs text-destructive"
    >
      {getUserMessage(error)}
    </div>
  );
}

function StreamErrorBanner({
  error,
  onReconnect,
}: {
  error: Error;
  onReconnect: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-border bg-muted flex items-center gap-3 border-t px-4 py-2.5"
    >
      <WifiOff className="text-destructive size-4 shrink-0" />
      <p className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
        {getUserMessage(error)}
      </p>
      <Button variant="outline" size="sm" onClick={onReconnect}>
        <RotateCcw className="mr-1.5 size-3" />
        Reconnect
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Write-Back Section (sidebar)
// ---------------------------------------------------------------------------

