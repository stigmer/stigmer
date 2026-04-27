import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@stigmer/theme";
import { phaseLabel, phaseDotColor, isActivePhase } from "@stigmer/react";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { useRunnerLogs } from "../../hooks/useRunnerLogs";

interface RunnerLogViewerProps {
  readonly runnerName: string | null;
  readonly runner: Runner | null;
  readonly onClose: () => void;
}

export function RunnerLogViewer({
  runnerName,
  runner,
  onClose,
}: RunnerLogViewerProps) {
  const { lines, isStreaming } = useRunnerLogs(runnerName);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 40;
  };

  if (!runnerName) return null;

  const phase = runner?.status?.phase ?? RunnerPhase.UNSPECIFIED;
  const info = runner?.status?.connectionInfo;
  const executions = runner?.status?.currentExecutions ?? 0;

  const headerSegments: string[] = [];
  if (info?.os && info?.arch) headerSegments.push(`${info.os}/${info.arch}`);
  if (info?.runnerVersion) headerSegments.push(`v${info.runnerVersion}`);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header bar */}
      <div className="flex flex-none items-center gap-3 border-b border-border px-4 py-2">
        <h3 className="truncate text-xs font-semibold text-foreground">
          {runnerName}
        </h3>

        <PhasePill phase={phase} />

        {isActivePhase(phase) && (
          <span className="text-[0.6rem] text-muted-foreground">
            {executions} exec{executions !== 1 ? "s" : ""}
          </span>
        )}

        {headerSegments.length > 0 && (
          <span className="hidden text-[0.6rem] font-mono text-muted-foreground sm:inline">
            {headerSegments.join(" \u00b7 ")}
          </span>
        )}

        <div className="flex-1" />

        {isStreaming && (
          <span className="inline-flex items-center gap-1 text-[0.6rem] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
            Live
          </span>
        )}

        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Close log viewer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[0.65rem] leading-relaxed text-foreground"
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground">
            {isStreaming ? "Waiting for output\u2026" : "No logs available."}
          </p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PhasePill({ phase }: { phase: RunnerPhase }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5",
        "text-[0.6rem] font-medium",
        isActivePhase(phase)
          ? "bg-success-subtle text-success"
          : "bg-muted text-muted-foreground",
      )}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${phaseDotColor(phase)}`}
        aria-hidden="true"
      />
      {phaseLabel(phase)}
    </span>
  );
}
