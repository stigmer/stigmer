"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionStatus } from "./ExecutionStatus";
import { MessageEntry } from "./MessageEntry";
import { HumanMessageBubble } from "./MessageEntry";
import { MessageInput } from "./MessageInput";
import {
  buildSubAgentIndex,
  isTerminalPhase,
} from "@/lib/execution";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArrowDown, AlertCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExecutionStreamProps {
  execution: AgentExecution | null;
  phase: ExecutionPhase;
  isConnected: boolean;
  error: string | null;
  onApproval?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => Promise<void>;
  isApprovalSubmitting?: boolean;
  onSendMessage?: (message: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExecutionStream(props: ExecutionStreamProps) {
  const {
    execution,
    phase,
    error,
    onApproval,
    isApprovalSubmitting = false,
    onSendMessage,
    className,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const messages = execution?.status?.messages ?? [];
  const subAgentIndex = useMemo(
    () => (execution ? buildSubAgentIndex(execution) : new Map()),
    [execution],
  );

  // ── Scroll-lock: auto-scroll when at bottom ──
  useEffect(() => {
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, isAtBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 48;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setIsAtBottom(atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setIsAtBottom(true);
  }, []);

  const isTerminal = isTerminalPhase(phase);
  const canSendMessage = isTerminal && !!onSendMessage;

  return (
    <div className={cn("flex flex-col", className)}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <ExecutionStatus phase={phase} />
        {execution?.status?.startedAt && (
          <time
            dateTime={execution.status.startedAt}
            className="text-xs text-muted-foreground"
          >
            {new Date(execution.status.startedAt).toLocaleTimeString()}
          </time>
        )}
      </div>

      {/* ── Stream content ── */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto"
      >
        <div className="space-y-4 p-4">
          {/* Show spec.message as the initial user message if no HUMAN message exists yet */}
          {messages.length === 0 && execution?.spec?.message && (
            <HumanMessageBubble content={execution.spec.message} />
          )}

          {messages.map((msg, index) => (
            <MessageEntry
              key={index}
              message={msg}
              subAgentIndex={subAgentIndex}
              onApproval={onApproval}
              isApprovalSubmitting={isApprovalSubmitting}
            />
          ))}

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p>{error}</p>
            </div>
          )}

          {/* Execution error from status */}
          {execution?.status?.error && isTerminal && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <p>{execution.status.error}</p>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Scroll-to-bottom FAB */}
        {!isAtBottom && (
          <Button
            size="icon"
            variant="secondary"
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 z-10 rounded-full shadow-md"
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="size-4" />
          </Button>
        )}
      </div>

      {/* ── Message input ── */}
      {canSendMessage && (
        <div className="border-t p-4">
          <MessageInput
            onSend={onSendMessage}
            placeholder="Send a follow-up message..."
          />
        </div>
      )}
    </div>
  );
}
