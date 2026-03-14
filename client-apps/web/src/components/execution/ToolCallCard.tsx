"use client";

import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ApprovalControls } from "./ApprovalControls";
import {
  toolCallStatusLabel,
  toolCallStatusVariant,
  qualifiedToolName,
  formatDuration,
} from "@/lib/execution";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { cn } from "@/lib/utils";
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
          "rounded-lg border bg-card text-card-foreground text-sm",
          isWaitingApproval && "border-primary/40 ring-1 ring-primary/20",
          className,
        )}
      >
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors rounded-t-lg">
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              (open || isWaitingApproval) && "rotate-90",
            )}
          />
          {isRunning ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-mono text-xs">{displayName}</span>
          <Badge
            variant={toolCallStatusVariant(toolCall.status)}
            className="ml-auto shrink-0 text-[10px]"
          >
            {toolCallStatusLabel(toolCall.status)}
          </Badge>
          {duration && (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {duration}
            </span>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t px-3 py-2 space-y-2">
            {toolCall.args && Object.keys(toolCall.args).length > 0 && (
              <ToolCallSection label="Arguments">
                <pre className="overflow-x-auto rounded bg-muted p-2 text-[11px] leading-relaxed">
                  {JSON.stringify(toolCall.args, null, 2)}
                </pre>
              </ToolCallSection>
            )}

            {toolCall.result && (
              <ToolCallSection label="Result">
                <pre className="overflow-x-auto rounded bg-muted p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                  {toolCall.result}
                </pre>
              </ToolCallSection>
            )}

            {toolCall.error && (
              <ToolCallSection label="Error">
                <p className="text-xs text-destructive">{toolCall.error}</p>
              </ToolCallSection>
            )}

            {toolCall.isStreaming && !toolCall.result && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Executing...
              </div>
            )}
          </div>

          {isWaitingApproval && onApproval && (
            <div className="border-t px-3 py-2">
              <ApprovalControls
                approvalMessage={
                  toolCall.approvalMessage ||
                  `Execute tool: ${displayName}`
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
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}
