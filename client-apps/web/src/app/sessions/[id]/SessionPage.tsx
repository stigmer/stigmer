"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Loader2, RotateCcw, WifiOff } from "lucide-react";
import {
  useSession,
  useSessionExecutions,
  useExecutionStream,
  isTerminalPhase,
  MessageThread,
} from "@stigmer/react";
import { Button } from "@/components/ui/button";

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();

  const { isLoading: sessionLoading, error: sessionError } = useSession(id);
  const {
    executions,
    isLoading: executionsLoading,
    error: executionsError,
  } = useSessionExecutions(id);

  const activeExecutionId = useMemo(() => {
    for (let i = executions.length - 1; i >= 0; i--) {
      const phase = executions[i].status?.phase;
      if (phase === undefined || !isTerminalPhase(phase)) {
        return executions[i].metadata?.id ?? null;
      }
    }
    return null;
  }, [executions]);

  const stream = useExecutionStream(activeExecutionId);

  const completedExecutions = useMemo(() => {
    if (!activeExecutionId) return executions;
    return executions.filter(
      (e) => (e.metadata?.id ?? "") !== activeExecutionId,
    );
  }, [executions, activeExecutionId]);

  const fetchedActiveExecution = useMemo(() => {
    if (!activeExecutionId) return null;
    return (
      executions.find(
        (e) => (e.metadata?.id ?? "") === activeExecutionId,
      ) ?? null
    );
  }, [executions, activeExecutionId]);

  const displayActiveExecution = stream.execution ?? fetchedActiveExecution;

  const isLoading = sessionLoading || executionsLoading;
  const error = sessionError || executionsError;

  if (isLoading) return <SessionSkeleton />;
  if (error) return <SessionError message={error} />;
  if (executions.length === 0) return <SessionStarting />;

  return (
    <div className="flex h-full flex-col">
      <MessageThread
        executions={completedExecutions}
        activeStreamExecution={displayActiveExecution}
        className="flex-1"
      />
      {stream.error && (
        <StreamErrorBanner
          message={stream.error}
          onReconnect={stream.reconnect}
        />
      )}
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
        {/* User message block */}
        <div className="rounded-lg bg-muted/50 px-4 py-3">
          <div className="h-4 w-3/5 rounded bg-muted" />
        </div>

        {/* AI response blocks */}
        <div className="space-y-2 px-4">
          <div className="h-4 w-4/5 rounded bg-muted/60" />
          <div className="h-4 w-3/5 rounded bg-muted/60" />
          <div className="h-4 w-2/5 rounded bg-muted/60" />
        </div>

        {/* Tool call block */}
        <div className="mx-4 h-8 w-2/5 rounded-md border border-border bg-muted/30" />

        {/* Second AI response */}
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
