"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Loader2,
  RotateCcw,
  WifiOff,
} from "lucide-react";
import {
  useSessionConversation,
  useModelRegistry,
  useWorkspaceEntries,
  useGitHubConnection,
  useOneTimeSecrets,
  MessageThread,
  SessionComposer,
  ExecutionProgress,
  ExecutionCostSummary,
} from "@stigmer/react";
import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { useDeploymentMode } from "@/hooks/useDeploymentMode";
import { Button } from "@/components/ui/button";

const STORAGE_KEY_MODEL = "stigmer:session:model";

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
  const { id } = useParams<{ id: string }>();
  const org = useActiveOrgSlug();
  const conv = useSessionConversation(id, org);
  const [modelId, setModelId] = usePersistedModel();

  const deploymentMode = useDeploymentMode();
  const gitHubConnection = useGitHubConnection(org);
  const workspace = useWorkspaceEntries();
  const secrets = useOneTimeSecrets();
  const [mcpServerUsages, setMcpServerUsages] = useState<McpServerUsageInput[]>([]);
  const [skillRefs, setSkillRefs] = useState<ResourceRef[]>([]);
  const initialSyncDone = useRef(false);

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
    (message: string, model?: string) => {
      const runtimeEnv = secrets.isEmpty
        ? undefined
        : secrets.toRuntimeEnv();

      conv.sendFollowUp(message, {
        modelName: model ?? modelId,
        workspaceEntries: workspace.hasEntries
          ? workspace.toInput()
          : undefined,
        mcpServerUsages: mcpServerUsages.length > 0 ? mcpServerUsages : undefined,
        skillRefs: skillRefs.length > 0 ? skillRefs : undefined,
        runtimeEnv,
      });

      secrets.clear();
    },
    [conv, modelId, workspace, mcpServerUsages, skillRefs, secrets],
  );

  const displayExecution = useMemo(() => {
    if (conv.activeStreamExecution) return conv.activeStreamExecution;
    const completed = conv.completedExecutions;
    return completed.length > 0 ? completed[completed.length - 1] : null;
  }, [conv.activeStreamExecution, conv.completedExecutions]);

  if (conv.isLoading) return <SessionSkeleton />;
  if (conv.loadError) return <SessionError message={conv.loadError} />;
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
            dismissedApprovalIds={conv.dismissedApprovalIds}
            workspaceEntries={conv.workspaceEntries}
            className="flex-1 lg:pr-[208px]"
          />
          <div className="lg:mr-[208px]">
            {conv.streamError && (
              <StreamErrorBanner
                message={conv.streamError}
                onReconnect={conv.reconnectStream}
              />
            )}
            {(conv.sendError || conv.approvalError) && (
              <div
                role="alert"
                className="border-border border-t px-4 py-2 text-xs text-destructive"
              >
                {conv.sendError || conv.approvalError}
              </div>
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
              enableFolderBrowser={deploymentMode === "local"}
              mcpServerUsages={mcpServerUsages}
              onMcpServerUsagesChange={setMcpServerUsages}
              skillRefs={skillRefs}
              onSkillRefsChange={setSkillRefs}
              secrets={secrets}
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
                <ExecutionCostSummary execution={displayExecution} />
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local sub-components — Console-specific, not exported
// ---------------------------------------------------------------------------

function SessionSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 p-4" aria-busy="true">
      <div className="animate-pulse space-y-4">
        <div className="rounded-lg bg-muted/50 px-4 py-3">
          <div className="h-4 w-3/5 rounded bg-muted" />
        </div>

        <div className="space-y-2 px-4">
          <div className="h-4 w-4/5 rounded bg-muted/60" />
          <div className="h-4 w-3/5 rounded bg-muted/60" />
          <div className="h-4 w-2/5 rounded bg-muted/60" />
        </div>

        <div className="mx-4 h-8 w-2/5 rounded-md border border-border bg-muted/30" />

        <div className="space-y-2 px-4">
          <div className="h-4 w-3/4 rounded bg-muted/60" />
          <div className="h-4 w-1/2 rounded bg-muted/60" />
        </div>
      </div>
    </div>
  );
}

function SessionError({ message }: { message: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="bg-destructive/10 mx-auto flex size-12 items-center justify-center rounded-full">
          <AlertTriangle className="text-destructive size-6" />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Failed to load session</h1>
          <p className="text-muted-foreground text-sm">{message}</p>
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

function StreamErrorBanner({
  message,
  onReconnect,
}: {
  message: string;
  onReconnect: () => void;
}) {
  return (
    <div
      role="alert"
      className="border-border bg-muted flex items-center gap-3 border-t px-4 py-2.5"
    >
      <WifiOff className="text-destructive size-4 shrink-0" />
      <p className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
        {message}
      </p>
      <Button variant="outline" size="sm" onClick={onReconnect}>
        <RotateCcw className="mr-1.5 size-3" />
        Reconnect
      </Button>
    </div>
  );
}
