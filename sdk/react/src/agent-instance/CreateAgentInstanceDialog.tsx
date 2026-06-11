"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { getUserMessage } from "@stigmer/sdk";
import { useCreateAgentInstance } from "./useCreateAgentInstance";
import { EnvironmentPicker } from "../environment/EnvironmentPicker";
import { InstanceVisibilitySelector } from "../library/InstanceVisibilitySelector";

/** Props for {@link CreateAgentInstanceDialog}. */
export interface CreateAgentInstanceDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should open or close. */
  readonly onOpenChange: (open: boolean) => void;
  /** Organization slug. */
  readonly org: string;
  /** Agent ID to bind the new instance to. */
  readonly agentId: string;
  /** Called after the instance is successfully created. */
  readonly onCreated?: (instance: AgentInstance) => void;
}

/**
 * Modal dialog for creating a new AgentInstance.
 *
 * Collects: name (required), description, environment bindings (ordered),
 * and visibility. Submits via `useCreateAgentInstance`.
 *
 * Uses native `<dialog>` element for proper focus trapping and escape handling.
 */
export function CreateAgentInstanceDialog({
  open,
  onOpenChange,
  org,
  agentId,
  onCreated,
}: CreateAgentInstanceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { create, isCreating, error, clearError } = useCreateAgentInstance();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [environmentRefs, setEnvironmentRefs] = useState<ResourceRef[]>([]);
  const [visibility, setVisibility] = useState(ApiResourceVisibility.visibility_private);

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setEnvironmentRefs([]);
    setVisibility(ApiResourceVisibility.visibility_private);
    clearError();
  }, [clearError]);

  const handleClose = useCallback(() => {
    dialogRef.current?.close();
    onOpenChange(false);
    resetForm();
  }, [onOpenChange, resetForm]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) return;

      try {
        const instance = await create({
          name: name.trim(),
          org,
          agentId,
          description: description.trim() || undefined,
          environmentRefs: environmentRefs.length > 0 ? environmentRefs : undefined,
          visibility,
        });
        onCreated?.(instance);
        handleClose();
      } catch {
        // error state is managed by the hook
      }
    },
    [name, org, agentId, description, environmentRefs, visibility, create, onCreated, handleClose],
  );

  // Sync native dialog open state
  const prevOpenRef = useRef(false);
  if (open !== prevOpenRef.current) {
    prevOpenRef.current = open;
    if (open) {
      // Must defer showModal to after render
      requestAnimationFrame(() => {
        if (dialogRef.current && !dialogRef.current.open) {
          dialogRef.current.showModal();
        }
      });
    } else if (dialogRef.current?.open) {
      dialogRef.current.close();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      className={cn(
        "fixed inset-0 m-auto w-full max-w-lg rounded-xl border border-border bg-popover p-0 shadow-xl",
        "backdrop:bg-black/50",
      )}
      aria-labelledby="create-agent-instance-title"
    >
      <form onSubmit={handleSubmit} className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="create-agent-instance-title" className="text-base font-semibold text-foreground">
            Create Agent Instance
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className={cn(
              "rounded-md p-1 text-muted-foreground",
              "hover:text-foreground hover:bg-accent-hover",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5">
          {/* Name */}
          <div>
            <label htmlFor="agent-instance-name" className="block text-sm font-medium text-foreground mb-1.5">
              Name <span className="text-destructive">*</span>
            </label>
            <input
              id="agent-instance-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. prod, staging, qa-team"
              disabled={isCreating}
              className={cn(
                "w-full rounded-md border border-border bg-background px-3 py-2 text-sm",
                "text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
              autoFocus
            />
            <p className="mt-1 text-[0.65rem] text-muted-foreground">
              A URL-friendly slug will be generated from this name.
            </p>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="agent-instance-description" className="block text-sm font-medium text-foreground mb-1.5">
              Description
            </label>
            <textarea
              id="agent-instance-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this instance used for?"
              disabled={isCreating}
              rows={2}
              className={cn(
                "w-full rounded-md border border-border bg-background px-3 py-2 text-sm resize-none",
                "text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            />
          </div>

          {/* Environments */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Environments
            </label>
            <p className="text-[0.65rem] text-muted-foreground mb-2">
              Bind credentials and configuration to this instance.
            </p>
            <EnvironmentPicker
              org={org}
              value={environmentRefs}
              onChange={setEnvironmentRefs}
              disabled={isCreating}
            />
          </div>

          {/* Visibility */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Visibility
            </label>
            <InstanceVisibilitySelector
              visibility={visibility}
              onVisibilityChange={setVisibility}
              mode="create"
              disabled={isCreating}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {getUserMessage(error)}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={isCreating}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              "text-foreground hover:bg-accent-hover",
              "focus:outline-none focus:ring-2 focus:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isCreating || !name.trim()}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              "bg-primary text-primary-foreground",
              "hover:bg-primary/90",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isCreating ? "Creating..." : "Create Instance"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
