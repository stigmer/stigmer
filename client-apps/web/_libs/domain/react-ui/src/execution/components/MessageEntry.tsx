import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { OutputBlock } from "./OutputBlock";
import { ToolCallCard } from "./ToolCallCard";
import { SubAgentCard } from "./SubAgentCard";
import { isHumanMessage, isAiMessage, isSystemMessage } from "../helpers";
import { User, BotMessageSquare, Info } from "lucide-react";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MessageEntryProps {
  message: AgentMessage;
  subAgentIndex: Map<string, SubAgentExecution>;
  onApproval?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => Promise<void>;
  isApprovalSubmitting?: boolean;
}

// ---------------------------------------------------------------------------
// Message dispatcher
// ---------------------------------------------------------------------------

export function MessageEntry({
  message,
  subAgentIndex,
  onApproval,
  isApprovalSubmitting,
}: MessageEntryProps) {
  if (isHumanMessage(message.type)) {
    return <HumanMessageBubble content={message.content} />;
  }

  if (isAiMessage(message.type)) {
    return (
      <AiMessageBlock
        message={message}
        subAgentIndex={subAgentIndex}
        onApproval={onApproval}
        isApprovalSubmitting={isApprovalSubmitting}
      />
    );
  }

  if (isSystemMessage(message.type)) {
    return <SystemMessageBlock content={message.content} />;
  }

  // MESSAGE_TOOL: tool results are rendered inline with the tool call card,
  // so we don't render a separate block for them.
  return null;
}

// ---------------------------------------------------------------------------
// Message type blocks
// ---------------------------------------------------------------------------

export function HumanMessageBubble({ content }: { content: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full">
        <User className="text-muted-foreground size-3.5" />
      </div>
      <div className="bg-muted min-w-0 flex-1 rounded-lg px-3 py-2 text-sm">
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

function AiMessageBlock({
  message,
  subAgentIndex,
  onApproval,
  isApprovalSubmitting,
}: {
  message: AgentMessage;
  subAgentIndex: Map<string, SubAgentExecution>;
  onApproval?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => Promise<void>;
  isApprovalSubmitting?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="bg-primary/10 flex size-7 shrink-0 items-center justify-center rounded-full">
        <BotMessageSquare className="text-primary size-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {message.content && (
          <OutputBlock
            content={message.content}
            isStreaming={message.isStreaming}
            model={message.model}
          />
        )}

        {message.toolCalls.map((tc) => {
          const subAgent = subAgentIndex.get(tc.id);
          if (subAgent) {
            return (
              <SubAgentCard
                key={tc.id}
                subAgent={subAgent}
                onApproval={onApproval}
                isApprovalSubmitting={isApprovalSubmitting}
              />
            );
          }
          return (
            <ToolCallCard
              key={tc.id}
              toolCall={tc}
              onApproval={onApproval}
              isApprovalSubmitting={isApprovalSubmitting}
            />
          );
        })}
      </div>
    </div>
  );
}

export function SystemMessageBlock({ content }: { content: string }) {
  if (!content) return null;
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <Info className="size-3 shrink-0" />
      <p>{content}</p>
    </div>
  );
}
