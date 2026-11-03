import { useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { Button } from "@stigmer/react-sdk";
import { useRunner } from "../hooks/EmbeddedRunnerContext";
import { runnerStatusLine, type RunnerStatusLine } from "../hooks/runner-state";

const DOT_TONE: Record<RunnerStatusLine["tone"], string> = {
  quiet: "bg-sidebar-muted-foreground/50",
  live: "bg-sidebar-foreground",
  alert: "bg-destructive",
};

/**
 * The sidebar row that says whether agents are running on this computer,
 * above the user menu. The desktop app runs agents in a process of its own;
 * when that process stops or cannot start, this row says so, with the reason
 * the host gave, and offers to start it again. Only the desktop has such a
 * process, so the row is the desktop's, passed into the kit's sidebar footer.
 */
export function RunnerStatus() {
  const { state, restart } = useRunner();
  const [isRestarting, setIsRestarting] = useState(false);
  const line = runnerStatusLine(state);

  const onAction = () => {
    setIsRestarting(true);
    void restart().finally(() => setIsRestarting(false));
  };

  return (
    <div className="flex flex-col gap-1 px-2 pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full", DOT_TONE[line.tone])}
        />
        <p role="status" className="min-w-0 flex-1 text-xs text-sidebar-muted-foreground">
          {line.label}
        </p>
        {line.action ? (
          <Button variant="outline" size="xs" onClick={onAction} disabled={isRestarting}>
            {line.action}
          </Button>
        ) : null}
      </div>
      {line.detail ? (
        <p className="line-clamp-3 break-words text-xs text-sidebar-muted-foreground">
          {line.detail}
        </p>
      ) : null}
    </div>
  );
}
