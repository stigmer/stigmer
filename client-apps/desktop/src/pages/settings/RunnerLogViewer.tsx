import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useRunnerLogs } from "../../hooks/useRunnerLogs";

interface RunnerLogViewerProps {
  readonly runnerName: string | null;
  readonly onClose: () => void;
}

export function RunnerLogViewer({
  runnerName,
  onClose,
}: RunnerLogViewerProps) {
  const { lines, isStreaming } = useRunnerLogs(runnerName);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  if (!runnerName) return null;

  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-foreground">
            {runnerName}
          </h3>
          {isStreaming && (
            <span className="inline-flex items-center gap-1 text-[0.6rem] text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              Live
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="Close log viewer"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 font-mono text-[0.65rem] leading-relaxed text-foreground">
        {lines.length === 0 ? (
          <p className="text-muted-foreground">
            {isStreaming
              ? "Waiting for output\u2026"
              : "No logs available."}
          </p>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
