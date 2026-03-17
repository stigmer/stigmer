"use client";

import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowUp, Loader2 } from "lucide-react";
import {
  ModelSelector,
  useWorkspaceEntries,
  WorkspaceEditor,
  useCreateSession,
  useCreateAgentExecution,
  useGitHubConnection,
} from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { useDeploymentMode } from "@/hooks/useDeploymentMode";

/**
 * Console-specific session launcher — the landing page widget that
 * composes SDK hooks and components into the "new session" experience.
 *
 * Flow: create session -> create first execution -> navigate.
 *
 * Adds org context, Next.js routing, Console layout, GitHub connection,
 * and deployment mode detection that would not belong in an embeddable
 * SDK component.
 */
export function SessionLauncher() {
  const router = useRouter();
  const org = useActiveOrgSlug();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const deploymentMode = useDeploymentMode();
  const gitHubConnection = useGitHubConnection();

  const [message, setMessage] = useState("");
  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const workspace = useWorkspaceEntries();
  const { create: createSession } = useCreateSession();
  const { create: createExecution } = useCreateAgentExecution();

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const trimmed = message.trim();
      if (!trimmed || isSubmitting) return;

      setIsSubmitting(true);
      setSubmitError(null);

      try {
        const { sessionId } = await createSession({
          org,
          subject: trimmed.slice(0, 120),
          workspaceEntries: workspace.hasEntries
            ? workspace.toInput()
            : undefined,
        });

        await createExecution({
          org,
          sessionId,
          message: trimmed,
          modelName: modelId,
        });

        router.push(`/sessions/${sessionId}`);
      } catch {
        setSubmitError("Failed to start session");
        toast.error("Failed to start session");
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      message,
      isSubmitting,
      org,
      modelId,
      workspace,
      createSession,
      createExecution,
      router,
    ],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl space-y-6">
        <h1 className="text-center text-lg font-medium text-foreground">
          What would you like to work on?
        </h1>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Textarea */}
          <div className="rounded-xl border border-border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                handleInput();
              }}
              onKeyDown={handleKeyDown}
              placeholder="Describe what you need help with..."
              disabled={isSubmitting}
              rows={3}
              className="block w-full resize-none bg-transparent px-4 pt-4 pb-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
              autoFocus
            />

            {/* Controls bar */}
            <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <ModelSelector
                  value={modelId}
                  onValueChange={setModelId}
                  disabled={isSubmitting}
                />
                {workspace.hasEntries ? (
                  <span className="rounded-md bg-muted px-2 py-1 text-[0.65rem] text-muted-foreground">
                    {workspace.entries.length} workspace
                    {workspace.entries.length !== 1 ? "s" : ""}
                  </span>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={!message.trim() || isSubmitting}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
                aria-label="Send message"
              >
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Error display */}
          {submitError && (
            <p className="text-xs text-destructive" role="alert">
              {submitError}
            </p>
          )}

          {/* Workspace editor with GitHub integration */}
          <WorkspaceEditor
            workspace={workspace}
            disabled={isSubmitting}
            gitHubConnection={gitHubConnection}
            enableGitHub
            enableLocal={deploymentMode === "local"}
            enableFolderBrowser={deploymentMode === "local"}
          />
        </form>

        <p className="text-center text-[0.65rem] text-muted-foreground">
          Press Enter to send, Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
