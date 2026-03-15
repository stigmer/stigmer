"use client";

import { useState } from "react";
import { Badge } from "../../internal/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../internal/ui/collapsible";
import { OutputBlock } from "./OutputBlock";
import { ToolCallCard } from "./ToolCallCard";
import {
  subAgentStatusLabel,
  subAgentStatusVariant,
  formatDuration,
  isAiMessage,
} from "../helpers";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SubAgentStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { ChevronRight, Bot, Loader2 } from "lucide-react";

interface SubAgentCardProps {
  subAgent: SubAgentExecution;
  onApproval?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => Promise<void>;
  isApprovalSubmitting?: boolean;
  className?: string;
}

export function SubAgentCard({
  subAgent,
  onApproval,
  isApprovalSubmitting = false,
  className,
}: SubAgentCardProps) {
  const [open, setOpen] = useState(false);
  const isActive = subAgent.status === SubAgentStatus.SUB_AGENT_IN_PROGRESS;
  const duration = formatDuration(subAgent.startedAt, subAgent.completedAt);
  const aiMessages = subAgent.messages.filter((m) => isAiMessage(m.type));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "rounded-lg border border-dashed bg-card text-card-foreground text-sm",
          className,
        )}
      >
        <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors rounded-t-lg">
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          {isActive ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Bot className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-medium text-xs">
            {subAgent.subject || subAgent.name}
          </span>
          <Badge
            variant={subAgentStatusVariant(subAgent.status)}
            className="ml-auto shrink-0 text-[10px]"
          >
            {subAgentStatusLabel(subAgent.status)}
          </Badge>
          {duration && (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {duration}
            </span>
          )}
          {subAgent.toolCalls.length > 0 && (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {subAgent.toolCalls.length} tool{subAgent.toolCalls.length !== 1 && "s"}
            </span>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t px-3 py-2 space-y-3">
            {subAgent.input && (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Task
                </p>
                <p className="text-xs text-muted-foreground">{subAgent.input}</p>
              </div>
            )}

            {aiMessages.map((msg, i) => (
              <OutputBlock
                key={i}
                content={msg.content}
                isStreaming={msg.isStreaming}
                model={msg.model}
              />
            ))}

            {subAgent.toolCalls.map((tc) => (
              <ToolCallCard
                key={tc.id}
                toolCall={tc}
                onApproval={onApproval}
                isApprovalSubmitting={isApprovalSubmitting}
              />
            ))}

            {subAgent.error && (
              <p className="text-xs text-destructive">{subAgent.error}</p>
            )}

            {subAgent.output && (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Result
                </p>
                <pre className="overflow-x-auto rounded bg-muted p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
                  {subAgent.output}
                </pre>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
