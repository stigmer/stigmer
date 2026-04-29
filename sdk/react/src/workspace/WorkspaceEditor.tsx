"use client";

import { useState, useCallback, type KeyboardEvent } from "react";
import type { UseWorkspaceEntriesReturn } from "./useWorkspaceEntries";
import type { UseGitHubConnectionReturn } from "../github/useGitHubConnection";
import { GitHubRepoPicker } from "../github/GitHubRepoPicker";
import { RunnerFileBrowser } from "../runner/RunnerFileBrowser";
import { useScrollShadows } from "../internal/useScrollShadows";
import { ScrollFade } from "../internal/ScrollFade";

/** Props for {@link WorkspaceEditor}. */
export interface WorkspaceEditorProps {
  /** Workspace state from {@link useWorkspaceEntries}. */
  readonly workspace: UseWorkspaceEntriesReturn;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /** Disables all add/remove interactions. */
  readonly disabled?: boolean;
  /** GitHub connection state. When provided, enables the GitHub repo picker. */
  readonly gitHubConnection?: UseGitHubConnectionReturn;
  /** Enable the "Connect GitHub" action. Default: true. */
  readonly enableGitHub?: boolean;
  /**
   * Enable the "Browse Folder" action.
   *
   * The action is only functional when `runnerId` is also provided,
   * since the file browser requires a connected runner to query.
   * When `runnerId` is null (Auto selected), the action is disabled.
   */
  readonly enableLocal?: boolean;
  /**
   * ID of the runner to use for filesystem browsing.
   *
   * When provided together with `enableLocal`, the "Browse Folder"
   * action drills into a {@link RunnerFileBrowser} that queries the
   * runner's filesystem via the `ListDirectory` command.
   */
  readonly runnerId?: string | null;
  /**
   * Native folder picker callback for desktop environments.
   *
   * When provided alongside `runnerId`, renders an "Open system dialog"
   * button in the Browse Folder drill-in view. Desktop-only enhancement.
   */
  readonly onBrowseLocalFolder?: () => Promise<string | null>;
  /**
   * Display name of the currently selected runner.
   * Passed through to {@link RunnerFileBrowser} for the context header.
   */
  readonly runnerName?: string;
  /**
   * Hostname of the runner's machine (e.g. "Alice's MacBook Pro").
   * Passed through to {@link RunnerFileBrowser} for the context header.
   */
  readonly runnerHostname?: string;
}

type ActivePanel = "browse" | "github" | null;

const TYPE_LABELS: Record<string, string> = {
  git: "GitHub",
};

/**
 * Styled component for managing workspace entries with a flat-list
 * layout and drill-in sub-views.
 *
 * The default view shows:
 * 1. Current workspace entries (with remove buttons)
 * 2. Action items: "Browse Folder" and "Connect GitHub"
 *
 * Each action drills into a sub-view (file browser or GitHub picker)
 * with a back button to return to the list. This follows the same
 * progressive-disclosure pattern as the Configure menu.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * function SessionSetup({ org }: { org: string }) {
 *   const workspace = useWorkspaceEntries();
 *   const gh = useGitHubConnection(org);
 *
 *   return (
 *     <WorkspaceEditor
 *       workspace={workspace}
 *       gitHubConnection={gh}
 *       enableGitHub
 *       enableLocal
 *       runnerId={browseRunnerId}
 *     />
 *   );
 * }
 * ```
 */
export function WorkspaceEditor({
  workspace,
  className,
  disabled,
  gitHubConnection,
  enableGitHub = true,
  enableLocal = false,
  runnerId,
  onBrowseLocalFolder,
  runnerName,
  runnerHostname,
}: WorkspaceEditorProps) {
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [manualBranch, setManualBranch] = useState("");
  const entryList = useScrollShadows();

  const canBrowse = enableLocal && !!runnerId;

  const handleGitHubSelect = useCallback(
    (repoUrl: string, branch: string) => {
      workspace.addGitRepo(repoUrl, branch);
    },
    [workspace],
  );

  const handleManualAdd = useCallback(() => {
    if (manualUrl.trim()) {
      workspace.addGitRepo(manualUrl.trim(), manualBranch.trim() || undefined);
      setManualUrl("");
      setManualBranch("");
    }
  }, [manualUrl, manualBranch, workspace]);

  const handleKeyDown = useCallback(
    (handler: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handler();
      }
    },
    [],
  );

  const goBack = useCallback(() => setActivePanel(null), []);

  // ---------------------------------------------------------------------------
  // Drill-in: Browse Folder
  // ---------------------------------------------------------------------------

  if (activePanel === "browse" && canBrowse) {
    return (
      <div className={["space-y-2", className].filter(Boolean).join(" ")}>
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeftIcon />
          Back
        </button>
        <div className="space-y-2">
          <RunnerFileBrowser
            runnerId={runnerId!}
            onSelect={(path) => {
              workspace.addLocalPath(path);
              setActivePanel(null);
            }}
            onCancel={goBack}
            runnerName={runnerName}
            runnerHostname={runnerHostname}
          />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Drill-in: Connect GitHub
  // ---------------------------------------------------------------------------

  if (activePanel === "github" && enableGitHub) {
    return (
      <div className={["space-y-2", className].filter(Boolean).join(" ")}>
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeftIcon />
          Back
        </button>
        {gitHubConnection ? (
          <GitHubPanel
            connection={gitHubConnection}
            onSelect={(url, branch) => {
              handleGitHubSelect(url, branch);
              setActivePanel(null);
            }}
            onClose={goBack}
          />
        ) : (
          <ManualGitPanel
            url={manualUrl}
            branch={manualBranch}
            onUrlChange={setManualUrl}
            onBranchChange={setManualBranch}
            onAdd={() => {
              handleManualAdd();
              setActivePanel(null);
            }}
            onCancel={goBack}
            onKeyDown={handleKeyDown(() => {
              handleManualAdd();
              setActivePanel(null);
            })}
          />
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Default view: flat list (entries + actions)
  // ---------------------------------------------------------------------------

  return (
    <div className={["space-y-2", className].filter(Boolean).join(" ")}>
      {/* Entry list */}
      {workspace.entries.length > 0 && (
        <div className="relative">
          {entryList.canScrollUp && <ScrollFade position="top" />}

          <div ref={entryList.scrollRef} className="max-h-28 space-y-1 overflow-y-auto">
            {workspace.entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 rounded-md border border-border bg-muted-faint px-2.5 py-1.5 text-xs"
              >
                {TYPE_LABELS[entry.type] ? (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">
                    {TYPE_LABELS[entry.type]}
                  </span>
                ) : (
                  <span className="shrink-0 text-muted-foreground">
                    <FolderIcon />
                  </span>
                )}
                <span
                  className={[
                    "min-w-0 flex-1 truncate text-foreground",
                    entry.type === "local" ? "[direction:rtl] text-left" : "",
                  ].join(" ")}
                  title={entry.name}
                >
                  <bdi>{entry.name}</bdi>
                </span>
                <button
                  type="button"
                  onClick={() => workspace.remove(entry.id)}
                  disabled={disabled}
                  className="shrink-0 text-muted-foreground hover:text-destructive disabled:pointer-events-none"
                  aria-label={`Remove ${entry.name}`}
                >
                  <XIcon />
                </button>
              </div>
            ))}
          </div>

          {entryList.canScrollDown && <ScrollFade position="bottom" />}
        </div>
      )}

      {/* Action items */}
      <div className="space-y-0.5">
        {enableLocal && (
          <button
            type="button"
            onClick={
              onBrowseLocalFolder
                ? async () => {
                    const path = await onBrowseLocalFolder();
                    if (path) workspace.addLocalPath(path);
                  }
                : () => setActivePanel("browse")
            }
            disabled={disabled || !runnerId}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs text-foreground transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40"
          >
            <FolderIcon />
            <span className="flex-1 text-left">Browse Folder</span>
            {!onBrowseLocalFolder && <ChevronRightIcon />}
          </button>
        )}
        {enableGitHub && (
          <button
            type="button"
            onClick={() => setActivePanel("github")}
            disabled={disabled}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs text-foreground transition-colors hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40"
          >
            <GitHubIcon />
            <span className="flex-1 text-left">Connect GitHub</span>
            <ChevronRightIcon />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GitHub panel (progressive disclosure: connect prompt or repo picker)
// ---------------------------------------------------------------------------

function GitHubPanel({
  connection,
  onSelect,
  onClose,
}: {
  connection: UseGitHubConnectionReturn;
  onSelect: (repoUrl: string, branch: string) => void;
  onClose: () => void;
}) {
  if (connection.isLoading) {
    return (
      <div className="py-4 text-center text-xs text-muted-foreground">
        Checking GitHub connection...
      </div>
    );
  }

  if (!connection.isConnected) {
    if (connection.isConnecting) {
      return (
        <div className="space-y-3 py-4 text-center">
          <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
          <p className="text-xs text-muted-foreground">
            Connecting to GitHub...
          </p>
        </div>
      );
    }

    const redirectUri = `${window.location.origin}/auth/github/callback`;

    return (
      <div className="space-y-3 text-center">
        <div className="space-y-1">
          <p className="text-xs font-medium text-foreground">
            Choose a GitHub repo to add to workspace
          </p>
          <p className="text-[0.65rem] text-muted-foreground">
            Connect your GitHub account so the agent can access your repos
          </p>
        </div>
        {connection.popupBlocked ? (
          <div className="space-y-2">
            <p className="text-[0.65rem] text-destructive">
              Popup was blocked by your browser.
            </p>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => connection.connect(redirectUri, { popup: true })}
                className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => connection.connect(redirectUri)}
                className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-xs text-background hover:bg-foreground-hover transition-colors"
              >
                <GitHubIcon />
                <span>Continue with redirect</span>
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => connection.connect(redirectUri, { popup: true })}
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-xs text-background hover:bg-foreground-hover transition-colors"
          >
            <GitHubIcon />
            <span>Connect GitHub</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          {connection.user?.avatarUrl && (
            <img
              src={connection.user.avatarUrl}
              alt=""
              className="h-4 w-4 rounded-full"
            />
          )}
          <span className="text-muted-foreground">
            {connection.user?.login ?? "Connected"}
          </span>
        </div>
        <button
          type="button"
          onClick={connection.disconnect}
          className="text-[0.6rem] text-muted-foreground hover:text-destructive transition-colors"
        >
          Disconnect
        </button>
      </div>
      <GitHubRepoPicker
        token={connection.token!}
        onSelect={onSelect}
        onCancel={onClose}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual git URL input (fallback for platform builders without GitHub OAuth)
// ---------------------------------------------------------------------------

function ManualGitPanel({
  url,
  branch,
  onUrlChange,
  onBranchChange,
  onAdd,
  onCancel,
  onKeyDown,
}: {
  url: string;
  branch: string;
  onUrlChange: (v: string) => void;
  onBranchChange: (v: string) => void;
  onAdd: () => void;
  onCancel: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-2">
      <input
        type="url"
        placeholder="https://github.com/org/repo.git"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        autoFocus
      />
      <input
        type="text"
        placeholder="Branch (optional)"
        value={branch}
        onChange={(e) => onBranchChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={!url.trim()}
          className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary-hover transition-colors disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronLeftIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.5 2.5L4 6L7.5 9.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
      <path d="M4.5 2.5L8 6L4.5 9.5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4L10 10M10 4L4 10" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 3.5V11a1 1 0 001 1h9a1 1 0 001-1V5.5a1 1 0 00-1-1H7L5.5 3H2.5a1 1 0 00-1 .5z" />
    </svg>
  );
}
