import { useState } from "react";
import { SidebarStatusRow } from "@stigmer/react-sdk/console";
import { useRunner } from "../hooks/EmbeddedRunnerContext";
import { runnerStatusLine } from "../hooks/runner-state";

/**
 * The sidebar row that says whether agents are running on this computer,
 * above the user menu. The desktop app runs agents in a process of its own;
 * when that process stops or cannot start, this row says so, with the reason
 * the host gave, and offers to start it again. Only the desktop has such a
 * process, so the row is the desktop's words (`runnerStatusLine`) drawn by
 * the kit's `SidebarStatusRow`, passed into the kit's sidebar footer.
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
    <SidebarStatusRow
      tone={line.tone}
      label={line.label}
      detail={line.detail}
      action={line.action !== undefined ? { label: line.action, onClick: onAction, busy: isRestarting } : undefined}
    />
  );
}
