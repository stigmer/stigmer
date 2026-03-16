"use client";

import { useState } from "react";
import { Badge } from "../../internal/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../internal/collapsible";
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
          "bg-card text-card-foreground rounded-lg border border-dashed text-sm",
          className,
        )}
      >
        <CollapsibleTrigger className="hover:bg-muted/50 flex w-full items-center gap-2 rounded-t-lg px-3 py-2 text-left transition-colors">
          <ChevronRight
            className={cn(
              "text-muted-foreground size-3.5 shrink-0 transition-transform",
              open && "rotate-90",
            )}
          />
          {isActive ? (
            <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
          ) : (
            <Bot className="text-muted-foreground size-3.5 shrink-0" />
          )}
          <span className="truncate text-xs font-medium">
            {subAgent.subject || subAgent.name}
          </span>
          <Badge
            variant={subAgentStatusVariant(subAgent.status)}
            className="ml-auto shrink-0 text-[10px]"
          >
            {subAgentStatusLabel(subAgent.status)}
          </Badge>
          {duration && (
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {duration}
            </span>
          )}
          {subAgent.toolCalls.length > 0 && (
            <span className="text-muted-foreground shrink-0 text-[10px]">
              {subAgent.toolCalls.length} tool
              {subAgent.toolCalls.length !== 1 && "s"}
            </span>
          )}
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-3 border-t px-3 py-2">
            {subAgent.input && (
              <div>
                <p className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wider uppercase">
                  Task
                </p>
                <p className="text-muted-foreground text-xs">
                  {subAgent.input}
                </p>
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
              <p className="text-destructive text-xs">{subAgent.error}</p>
            )}

            {subAgent.output && (
              <div>
                <p className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wider uppercase">
                  Result
                </p>
                <pre className="bg-muted overflow-x-auto rounded p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
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
