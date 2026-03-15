"use client";

import { useCallback, useState } from "react";
import { Button } from "../internal/button";
import { Textarea } from "../internal/textarea";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { Check, X, SkipForward, Loader2 } from "lucide-react";

interface ApprovalControlsProps {
  approvalMessage: string;
  onSubmit: (action: ApprovalAction, comment?: string) => Promise<void>;
  isSubmitting: boolean;
  className?: string;
}

export function ApprovalControls({
  approvalMessage,
  onSubmit,
  isSubmitting,
  className,
}: ApprovalControlsProps) {
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");

  const handleAction = useCallback(
    async (action: ApprovalAction) => {
      await onSubmit(action, comment || undefined);
      setComment("");
      setShowComment(false);
    },
    [onSubmit, comment],
  );

  return (
    <div
      className={cn(
        "border-primary/30 bg-primary/5 space-y-3 rounded-lg border-2 p-3",
        className,
      )}
    >
      <p className="text-sm font-medium">{approvalMessage}</p>

      {showComment && (
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional comment..."
          className="min-h-10 text-sm"
          disabled={isSubmitting}
        />
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => handleAction(ApprovalAction.APPROVE)}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
          Approve
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => handleAction(ApprovalAction.SKIP)}
          disabled={isSubmitting}
        >
          <SkipForward className="size-3.5" />
          Skip
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => handleAction(ApprovalAction.REJECT)}
          disabled={isSubmitting}
        >
          <X className="size-3.5" />
          Reject
        </Button>
        {!showComment && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowComment(true)}
            disabled={isSubmitting}
            className="text-muted-foreground ml-auto text-xs"
          >
            Add comment
          </Button>
        )}
      </div>
    </div>
  );
}
