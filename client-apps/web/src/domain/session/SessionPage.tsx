"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Loader2,
  RotateCcw,
  WifiOff,
} from "lucide-react";
import {
  useSessionPageFlow,
  useGitHubConnection,
  MessageThread,
  ThreadSkeleton,
  SessionComposer,
  ExecutionProgress,
  UsageWidget,
  ArtifactsWidget,
  WriteBacksWidget,
  SecretFlowErrorGuide,
  isSecretFlowError,
  useActiveOrgSlug,
} from "@stigmer/react";
import { getUserMessage } from "@stigmer/sdk";
import { useDeploymentMode } from "@/domain/_shared/hooks/useDeploymentMode";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { Button } from "@/domain/_shared/ui/button";

export default function SessionPage() {
  const id = useStaticRouteParam("id");
  if (!id) return <SessionSkeleton />;
  return <SessionPageInner id={id} />;
}

export function SessionPageInner({ id }: { id: string }) {
  const org = useActiveOrgSlug();
  const deploymentMode = useDeploymentMode();
  const gitHubConnection = useGitHubConnection(org);

  const flow = useSessionPageFlow({ sessionId: id, org });
  const { conv } = flow;
  const [modelId, setModelId] = flow.model;

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
            sandboxWorkspaceRoot={flow.sandboxWorkspaceRoot}
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
              onSubmit={flow.handleSubmit}
              isSubmitting={conv.isSending}
              disabled={!conv.canSendFollowUp}
              org={org}
              harness={flow.harness}
              defaultModelId={modelId}
              onModelChange={setModelId}
              workspace={flow.workspace}
              gitHubConnection={gitHubConnection}
              enableGitHub
              enableLocal={deploymentMode === "local"}
              agentRef={flow.agentRef}
              onAgentRefChange={flow.setAgentRef}
              onAgentResolutionChange={flow.setResolution}
              mcpServerUsages={flow.mcpServerUsages}
              onMcpServerUsagesChange={flow.setMcpServerUsages}
              skillRefs={flow.skillRefs}
              onSkillRefsChange={flow.setSkillRefs}
              sessionVariables={flow.sessionVariables}
              className="px-4 py-3"
            />
          </div>
        </div>
        <aside
          className="hidden w-80 shrink-0 flex-col gap-3 overflow-y-auto py-4 pr-6 lg:flex"
          aria-label="Execution details"
        >
          {flow.displayExecution && (
            <>
              <div className="rounded-lg border border-border bg-card p-3">
                <ExecutionProgress execution={flow.displayExecution} />
              </div>
              <div className="rounded-lg border border-border bg-card p-3">
                <UsageWidget executions={flow.allExecutions} />
              </div>
            </>
          )}
          <WriteBacksWidget executions={flow.allExecutions} />
          <ArtifactsWidget executions={flow.allExecutions} org={org} />
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
    <div className="flex h-full w-full flex-col pl-[220px]">
      <ThreadSkeleton className="flex-1 px-0" />
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
