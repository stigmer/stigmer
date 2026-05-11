import { useParams } from "react-router-dom";
import {
  AlertTriangle,
  Loader2,
  RotateCcw,
  WifiOff,
} from "lucide-react";
import {
  useSessionPageFlow,
  useActiveOrgSlug,
  MessageThread,
  ThreadSkeleton,
  SessionComposer,
  ExecutionProgress,
  UsageWidget,
  ArtifactsWidget,
  WriteBacksWidget,
  SecretFlowErrorGuide,
  isSecretFlowError,
} from "@stigmer/react";
import { getUserMessage } from "@stigmer/sdk";
import { useDesktopGitHubConnection } from "../hooks/useDesktopGitHubConnection";

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <SessionSkeleton />;
  return <SessionPageInner id={id} />;
}

function SessionPageInner({ id }: { id: string }) {
  const org = useActiveOrgSlug();
  const gitHubConnection = useDesktopGitHubConnection(org);

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
              enableLocal
              agentRef={flow.agentRef}
              onAgentRefChange={flow.setAgentRef}
              onAgentResolutionChange={flow.setResolution}
              isDefaultAgent={flow.isDefaultAgent}
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

function SessionSkeleton() {
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
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive-subtle">
          <AlertTriangle className="size-6 text-destructive" />
        </div>
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Failed to load session</h1>
          <p className="text-sm text-muted-foreground">{getUserMessage(error)}</p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          <RotateCcw className="size-3.5" />
          Try again
        </button>
      </div>
    </div>
  );
}

function SessionStarting() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="space-y-2 text-center">
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Starting session…</p>
      </div>
    </div>
  );
}

function SendErrorBanner({ error }: { error: Error }) {
  if (isSecretFlowError(error)) {
    return <SecretFlowErrorGuide error={error} className="mx-4 my-2" />;
  }
  return (
    <div role="alert" className="border-t border-border px-4 py-2 text-xs text-destructive">
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
    <div role="alert" className="flex items-center gap-3 border-t border-border bg-muted px-4 py-2.5">
      <WifiOff className="size-4 shrink-0 text-destructive" />
      <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {getUserMessage(error)}
      </p>
      <button
        onClick={onReconnect}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-card"
      >
        <RotateCcw className="size-3" />
        Reconnect
      </button>
    </div>
  );
}
