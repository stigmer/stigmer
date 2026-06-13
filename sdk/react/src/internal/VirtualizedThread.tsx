"use client";

import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithRef,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { cn } from "@stigmer/theme";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  ThreadItemRenderer,
  type ThreadItem,
} from "../execution/MessageThread";
import { FilePathContext, type FilePathContextValue } from "../execution/FilePathContext";
import { SandboxContext, type SandboxContextValue } from "../execution/SandboxContext";
import { DevProfiler, useDomNodeCount } from "./dev";
import { JumpToLatestButton } from "./JumpToLatestButton";
import { ThreadItemWrapper } from "./ThreadItemWrapper";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface VirtualizedThreadProps {
  readonly items: readonly ThreadItem[];
  readonly formatToolCallSummary?: (toolCalls: readonly ToolCall[]) => string;
  readonly onApprovalSubmit?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => void;
  readonly submittingApprovalIds?: ReadonlySet<string>;
  readonly filePathCtx: FilePathContextValue;
  readonly sandboxCtx: SandboxContextValue;
  readonly onBuildFromPlan?: () => void;
  readonly org?: string;
  readonly planActionsDisabled?: boolean;
  readonly centerContent?: boolean;
  readonly onRetrySend?: () => void;
  readonly onRetryExecution?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Scrollbar classes shared with the non-virtualized path
// ---------------------------------------------------------------------------

const SCROLLBAR_CLASSES = cn(
  "[scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]",
  "[&::-webkit-scrollbar]:w-1.5",
  "[&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/40",
);

// ---------------------------------------------------------------------------
// Custom Virtuoso components
// ---------------------------------------------------------------------------

const ScrollerWithA11y = forwardRef<
  HTMLDivElement,
  ComponentPropsWithRef<"div">
>(function ScrollerWithA11y(props, ref) {
  return (
    <div
      {...props}
      ref={ref}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      className={cn(props.className, SCROLLBAR_CLASSES)}
    />
  );
});

// ---------------------------------------------------------------------------
// VirtualizedThread
// ---------------------------------------------------------------------------

const NEAR_BOTTOM_THRESHOLD_PX = 80;

/**
 * Internal component that renders a `MessageThread` item list via
 * `react-virtuoso`. Handles bottom-anchored chat layout,
 * follow-output scroll behavior, and the "Jump to latest" button.
 *
 * Not part of the public API — used only when `MessageThread` receives
 * `virtualized={true}`.
 *
 * @internal
 */
export function VirtualizedThread({
  items,
  formatToolCallSummary,
  onApprovalSubmit,
  submittingApprovalIds,
  filePathCtx,
  sandboxCtx,
  onBuildFromPlan,
  org,
  planActionsDisabled,
  centerContent,
  onRetrySend,
  onRetryExecution,
}: VirtualizedThreadProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  useDomNodeCount(scrollerRef, "MessageThread:virtualized");

  const handleFollowOutput = useCallback(
    (atBottom: boolean) => (atBottom ? "smooth" : false),
    [],
  );

  const handleScrollerRef = useCallback((ref: HTMLElement | Window | null) => {
    scrollerRef.current = ref instanceof HTMLDivElement ? ref : null;
  }, []);

  const jumpToLatest = useCallback(() => {
    virtuosoRef.current?.scrollToIndex({
      index: "LAST",
      behavior: "smooth",
    });
  }, []);

  const renderProps = useMemo(
    () => ({
      formatToolCallSummary,
      onApprovalSubmit,
      submittingApprovalIds,
      onBuildFromPlan,
      org,
      planActionsDisabled,
      onRetrySend,
      onRetryExecution,
    }),
    [formatToolCallSummary, onApprovalSubmit, submittingApprovalIds, onBuildFromPlan, org, planActionsDisabled, onRetrySend, onRetryExecution],
  );

  return (
    <>
      <SandboxContext.Provider value={sandboxCtx}>
      <FilePathContext.Provider value={filePathCtx}>
      <DevProfiler id="MessageThread:virtualized">
        <Virtuoso
          ref={virtuosoRef}
          data={items as ThreadItem[]}
          alignToBottom
          followOutput={handleFollowOutput}
          atBottomStateChange={setIsAtBottom}
          atBottomThreshold={NEAR_BOTTOM_THRESHOLD_PX}
          computeItemKey={(_index, item) => item.key}
          increaseViewportBy={{ top: 200, bottom: 200 }}
          scrollerRef={handleScrollerRef}
          className="h-full"
          components={{ Scroller: ScrollerWithA11y }}
          itemContent={(index, item) => (
            <div className={cn("pb-4 pt-0 first:pt-6", centerContent && "mx-auto w-full max-w-3xl px-4")}>
              <ThreadItemWrapper animate={index >= items.length - 2}>
                <ThreadItemRenderer
                  item={item}
                  {...renderProps}
                />
              </ThreadItemWrapper>
            </div>
          )}
        />
      </DevProfiler>
      </FilePathContext.Provider>
      </SandboxContext.Provider>
      <JumpToLatestButton onClick={jumpToLatest} visible={!isAtBottom} />
    </>
  );
}
