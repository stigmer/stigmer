"use client";

import { useState, useCallback } from "react";
import { Badge } from "../internal/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../internal/collapsible";
import { ApprovalControls } from "./ApprovalControls";
import {
  toolCallStatusLabel,
  toolCallStatusVariant,
  qualifiedToolName,
  formatDuration,
} from "../helpers";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { cn } from "@stigmer/theme";
import { ChevronRight, Wrench, Loader2 } from "lucide-react";

interface ToolCallCardProps {
  toolCall: ToolCall;
  /** Callback for approval submission. Only required when tool is awaiting approval. */
  onApproval?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => Promise<void>;
  isApprovalSubmitting?: boolean;
  className?: string;
}

export function ToolCallCard({
  toolCall,
  onApproval,
  isApprovalSubmitting = false,
  className,
}: ToolCallCardProps) {
  const [open, setOpen] = useState(false);
  const isWaitingApproval =
    toolCall.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL;
  const isRunning = toolCall.status === ToolCallStatus.TOOL_CALL_RUNNING;
  const duration = formatDuration(toolCall.startedAt, toolCall.completedAt);
  const displayName = qualifiedToolName(toolCall.name, toolCall.mcpServerSlug);

  const handleApproval = useCallback(
    async (action: ApprovalAction, comment?: string) => {
      await onApproval?.(toolCall.id, action, comment);
    },
    [onApproval, toolCall.id],
  );

  return (
    <Collapsible open={open || isWaitingApproval} onOpenChange={setOpen}>
      <div
        className={cn(
          "bg-card text-card-foreground rounded-lg border text-sm",
          isWaitingApproval && "border-primary/40 ring-primary/20 ring-1",
          className,
        )}
      >
        <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-t-lg px-3 py-2 text-left transition-colors">
          <ChevronRight
            className={cn(
              "text-muted-foreground size-3.5 shrink-0 transition-transform",
              (open || isWaitingApproval) && "rotate-90",
            )}
          />
          {isRunning ? (
            <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
          ) : (
            <Wrench className="text-muted-foreground size-3.5 shrink-0" />
          )}
          <span className="truncate font-mono text-xs">{displayName}</span>
          <Badge
            variant={toolCallStatusVariant(toolCall.status)}
            className="ml-auto shrink-0 text-[10px]"
          >
            {toolCallStatusLabel(toolCall.status)}
          </Badge>
          {duration && (
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {duration}
            </span>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-2 border-t px-3 py-2">
            {toolCall.args && Object.keys(toolCall.args).length > 0 && (
              <ToolCallSection label="Arguments">
                <pre className="bg-muted overflow-x-auto rounded p-2 text-[11px] leading-relaxed">
                  {JSON.stringify(toolCall.args, null, 2)}
                </pre>
              </ToolCallSection>
            )}

            {toolCall.result && (
              <ToolCallSection label="Result">
                <pre className="bg-muted overflow-x-auto rounded p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                  {toolCall.result}
                </pre>
              </ToolCallSection>
            )}

            {toolCall.error && (
              <ToolCallSection label="Error">
                <p className="text-destructive text-xs">{toolCall.error}</p>
              </ToolCallSection>
            )}

            {toolCall.isStreaming && !toolCall.result && (
              <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Loader2 className="size-3 animate-spin" />
                Executing...
              </div>
            )}
          </div>

          {isWaitingApproval && onApproval && (
            <div className="border-t px-3 py-2">
              <ApprovalControls
                approvalMessage={
                  toolCall.approvalMessage || `Execute tool: ${displayName}`
                }
                onSubmit={handleApproval}
                isSubmitting={isApprovalSubmitting}
              />
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function ToolCallSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wider uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}
