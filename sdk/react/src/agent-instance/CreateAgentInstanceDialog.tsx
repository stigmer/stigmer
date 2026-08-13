"use client";

import { useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { DialogShell } from "../internal/DialogShell.js";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { getUserMessage } from "@stigmer/sdk";
import { useCreateAgentInstance } from "./useCreateAgentInstance.js";
import { EnvironmentPicker } from "../environment/EnvironmentPicker.js";
import { InstanceVisibilitySelector } from "../library/InstanceVisibilitySelector.js";

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
  const { create, isCreating, error, clearError } = useCreateAgentInstance();

  // Instance-scoped element ids (oss#593): a reusable component must not
  // hardcode DOM ids — hosts legitimately mount this dialog more than once
  // per page (e.g. zone-cached detail pages), and duplicate ids silently
  // break the label→input association for every copy after the first.
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const nameId = `${baseId}-name`;
  const descriptionId = `${baseId}-description`;

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
    onOpenChange(false);
    resetForm();
  }, [onOpenChange, resetForm]);

  const handleShellOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) handleClose();
    },
    [handleClose],
  );

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

  return (
    <DialogShell
      open={open}
      onOpenChange={handleShellOpenChange}
      width="lg"
      aria-labelledby={titleId}
    >
      <form onSubmit={handleSubmit} className="stg:flex stg:flex-col">
        {/* Header */}
        <div className="stg:flex stg:items-center stg:justify-between stg:border-b stg:border-border stg:px-6 stg:py-4">
          <h2 id={titleId} className="stg:text-base stg:font-semibold stg:text-foreground">
            Create Agent Instance
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className={cn(
              "stg:rounded-md stg:p-1 stg:text-muted-foreground",
              "stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
            )}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="stg:space-y-5 stg:px-6 stg:py-5">
          {/* Name */}
          <div>
            <label htmlFor={nameId} className="stg:block stg:text-sm stg:font-medium stg:text-foreground stg:mb-1.5">
              Name <span className="stg:text-destructive">*</span>
            </label>
            <input
              id={nameId}
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. prod, staging, qa-team"
              disabled={isCreating}
              className={cn(
                "stg:w-full stg:rounded-md stg:border stg:border-border stg:bg-background stg:px-3 stg:py-2 stg:text-sm",
                "stg:text-foreground stg:placeholder:text-muted-foreground",
                "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
                "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
              )}
              autoFocus
            />
            <p className="stg:mt-1 stg:text-[0.65rem] stg:text-muted-foreground">
              A URL-friendly slug will be generated from this name.
            </p>
          </div>

          {/* Description */}
          <div>
            <label htmlFor={descriptionId} className="stg:block stg:text-sm stg:font-medium stg:text-foreground stg:mb-1.5">
              Description
            </label>
            <textarea
              id={descriptionId}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this instance used for?"
              disabled={isCreating}
              rows={2}
              className={cn(
                "stg:w-full stg:rounded-md stg:border stg:border-border stg:bg-background stg:px-3 stg:py-2 stg:text-sm stg:resize-none",
                "stg:text-foreground stg:placeholder:text-muted-foreground",
                "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
                "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
              )}
            />
          </div>

          {/* Environments */}
          <div>
            <label className="stg:block stg:text-sm stg:font-medium stg:text-foreground stg:mb-1.5">
              Environments
            </label>
            <p className="stg:text-[0.65rem] stg:text-muted-foreground stg:mb-2">
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
            <label className="stg:block stg:text-sm stg:font-medium stg:text-foreground stg:mb-1.5">
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
            <div className="stg:rounded-md stg:bg-destructive/10 stg:px-3 stg:py-2 stg:text-sm stg:text-destructive" role="alert">
              {getUserMessage(error)}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="stg:flex stg:items-center stg:justify-end stg:gap-2 stg:border-t stg:border-border stg:px-6 stg:py-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={isCreating}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium",
              "stg:text-foreground stg:hover:bg-accent-hover",
              "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
              "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
            )}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isCreating || !name.trim()}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium",
              "stg:bg-primary stg:text-primary-foreground",
              "stg:hover:bg-primary/90",
              "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring stg:focus:ring-offset-2",
              "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
            )}
          >
            {isCreating ? "Creating..." : "Create Instance"}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
