"use client";

import { useState, useCallback, type FormEvent } from "react";
import type { UseWorkspaceEntriesReturn } from "./useWorkspaceEntries";

export interface WorkspaceEditorProps {
  readonly workspace: UseWorkspaceEntriesReturn;
  readonly className?: string;
  readonly disabled?: boolean;
}

/**
 * Styled component that renders add/remove UI for workspace entries.
 * Accepts a {@link UseWorkspaceEntriesReturn} (from `useWorkspaceEntries()`)
 * as props.
 *
 * All visual properties flow through `--stgm-*` tokens.
 * Platform builders who need custom workspace UI use
 * `useWorkspaceEntries()` directly.
 */
export function WorkspaceEditor({
  workspace,
  className,
  disabled,
}: WorkspaceEditorProps) {
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<"git" | "local">("git");
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [localPath, setLocalPath] = useState("");

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (type === "git" && url.trim()) {
        workspace.addGitRepo(url.trim(), branch.trim() || undefined);
        setUrl("");
        setBranch("");
      } else if (type === "local" && localPath.trim()) {
        workspace.addLocalPath(localPath.trim());
        setLocalPath("");
      }
      setShowForm(false);
    },
    [type, url, branch, localPath, workspace],
  );

  return (
    <div className={["space-y-2", className].filter(Boolean).join(" ")}>
      {/* Entry list */}
      {workspace.entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs"
        >
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] uppercase text-muted-foreground">
            {entry.type}
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground">
            {entry.name}
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

      {/* Add form / trigger */}
      {showForm ? (
        <form
          onSubmit={handleSubmit}
          className="space-y-2 rounded-md border border-border bg-card p-3"
        >
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType("git")}
              className={[
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                type === "git"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              Git
            </button>
            <button
              type="button"
              onClick={() => setType("local")}
              className={[
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                type === "local"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              ].join(" ")}
            >
              Local
            </button>
          </div>

          {type === "git" ? (
            <div className="space-y-1.5">
              <input
                type="url"
                placeholder="https://github.com/org/repo.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
                autoFocus
              />
              <input
                type="text"
                placeholder="Branch (optional)"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          ) : (
            <input
              type="text"
              placeholder="/path/to/project"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              required
              autoFocus
            />
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Add
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          disabled={disabled}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:pointer-events-none disabled:opacity-50"
        >
          <PlusIcon />
          <span>Add workspace</span>
        </button>
      )}
    </div>
  );
}

function XIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4L10 10M10 4L4 10" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 3V11M3 7H11" />
    </svg>
  );
}
