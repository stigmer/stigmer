"use client";

import { cn } from "@stigmer/theme";
import { ContextPopover } from "./ContextPopover.js";
import { ConfigureMenu, type ConfigureMenuItem } from "./ConfigureMenu.js";
import { ModelSelector } from "../models/ModelSelector.js";
import { HarnessSelector } from "../models/HarnessSelector.js";
import type { HarnessOption } from "../models/harness.js";
import type { ServiceTierOption } from "../models/service-tier.js";
import { InteractionModePicker, type InteractionModeOption } from "./InteractionModePicker.js";
import {
  PaperclipIcon,
  WorkspaceIcon,
  ArrowUpIcon,
  SpinnerIcon,
  StopIcon,
} from "./icons.js";

export interface ComposerToolbarProps {
  readonly disabled: boolean;
  readonly isSubmitting: boolean;
  readonly canSend: boolean;
  readonly onSend: () => void;
  /**
   * When provided, the primary button becomes a Stop control (enabled even
   * while the rest of the composer is disabled) and the Send button is hidden.
   * Driven by the active execution being stoppable.
   */
  readonly onStop?: () => void;
  /** `true` while a stop request is in flight — shows a spinner on the Stop button. */
  readonly isStopping?: boolean;

  // -- Left group: Primary state --------------------------------------------

  readonly showHarnessSelector: boolean;
  readonly harness?: HarnessOption;
  readonly onHarnessChange: (harness: HarnessOption) => void;

  readonly showInteractionModePicker: boolean;
  readonly interactionMode?: InteractionModeOption;
  readonly onInteractionModeChange: (mode: InteractionModeOption) => void;

  readonly showModelSelector: boolean;
  readonly modelId?: string;
  readonly onModelChange: (id: string) => void;
  /** Current service tier for the selected model (#357). */
  readonly serviceTier?: ServiceTierOption;
  /** Enables the fast-tier toggle inside the model selector. */
  readonly onServiceTierChange?: (tier: ServiceTierOption) => void;

  // -- Right group: Secondary actions (icon-only) ---------------------------

  readonly showWorkspace: boolean;
  readonly workspaceCount: number;
  /** Pre-built workspace editor content for the popover. */
  readonly workspaceContent: React.ReactNode;
  /**
   * When provided, clicking the workspace icon invokes this callback
   * directly instead of opening the popover. Used when there is only
   * one possible action (e.g. desktop with zero entries → native folder
   * dialog) so the user skips the redundant intermediate menu.
   */
  readonly onWorkspaceDirectAction?: () => void;

  readonly showAttach: boolean;
  readonly attachmentCount: number;
  readonly onAttachClick: () => void;

  readonly configureItems: readonly ConfigureMenuItem[];
  readonly configOpen: boolean;
  readonly onConfigOpenChange: (open: boolean) => void;
  readonly configActivePanel: string | null;
  readonly onConfigActivePanelChange: (panel: string | null) => void;
  /** Render the picker content for a given configure panel id. */
  readonly renderConfigPanel: (itemId: string) => React.ReactNode;
}

/**
 * Composer toolbar — Zone 3 of the SessionComposer.
 *
 * Layout follows a two-group pattern inspired by Cursor's compact approach:
 *
 * **Left group (primary state):** Interaction Mode, Model Selector
 * **Right group (secondary actions, icon-only):** Workspace, Attach, Configure, Send
 *
 * Primary state indicators retain text labels (users glance at mode and model
 * frequently). Secondary actions use icon-only buttons with tooltips and
 * aria-labels — they are actions triggered occasionally, not state to monitor.
 *
 * This separation follows Fitts's Law (related actions clustered near Send),
 * Gestalt proximity (left = "what," right = "do"), and Nielsen H8 (minimal
 * visual weight for secondary controls).
 */
export function ComposerToolbar({
  disabled,
  isSubmitting,
  canSend,
  onSend,
  onStop,
  isStopping = false,
  showAttach,
  attachmentCount,
  onAttachClick,
  showWorkspace,
  workspaceCount,
  workspaceContent,
  onWorkspaceDirectAction,
  configureItems,
  configOpen,
  onConfigOpenChange,
  configActivePanel,
  onConfigActivePanelChange,
  renderConfigPanel,
  showHarnessSelector,
  harness,
  onHarnessChange,
  showInteractionModePicker,
  interactionMode,
  onInteractionModeChange,
  showModelSelector,
  modelId,
  onModelChange,
  serviceTier,
  onServiceTierChange,
}: ComposerToolbarProps) {
  const showHarnessSeparate = showHarnessSelector && !showModelSelector;

  return (
    <div className="flex items-center justify-between gap-2 border-t border-border-muted px-3 py-2">
      {/* ---- Left group: Primary state (Mode + Model) ---- */}

      <div className="flex min-w-0 items-center gap-1.5">
        {showInteractionModePicker && (
          <InteractionModePicker
            value={interactionMode ?? "agent"}
            onValueChange={onInteractionModeChange}
            disabled={disabled}
          />
        )}

        {showHarnessSeparate && (
          <HarnessSelector
            value={harness ?? "native"}
            onValueChange={onHarnessChange}
            disabled={disabled}
          />
        )}

        {showModelSelector && (
          <ModelSelector
            value={modelId}
            onValueChange={onModelChange}
            harness={showHarnessSelector ? undefined : harness}
            initialHarness={showHarnessSelector ? harness : undefined}
            onHarnessChange={showHarnessSelector ? onHarnessChange : undefined}
            serviceTier={serviceTier}
            onServiceTierChange={onServiceTierChange}
            disabled={disabled}
          />
        )}
      </div>

      {/* ---- Right group: Secondary actions (icon-only) + Send ---- */}

      <div className="flex shrink-0 items-center gap-1">
        {showWorkspace && (
          onWorkspaceDirectAction
            ? <button
                type="button"
                disabled={disabled}
                onClick={onWorkspaceDirectAction}
                title="Workspace"
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md text-xs transition-colors",
                  "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
                  "disabled:pointer-events-none disabled:opacity-50",
                )}
                aria-label="Workspace"
              >
                <span className="relative">
                  <WorkspaceIcon />
                  {workspaceCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[0.5rem] font-medium leading-none text-primary-foreground">
                      {workspaceCount}
                    </span>
                  )}
                </span>
              </button>
            : <ContextPopover
                icon={<WorkspaceIcon />}
                label="Workspace"
                count={workspaceCount}
                disabled={disabled}
              >
                {workspaceContent}
              </ContextPopover>
        )}

        {showAttach && (
          <button
            type="button"
            disabled={disabled}
            onClick={onAttachClick}
            title="Attach files"
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md text-xs transition-colors",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
            aria-label="Attach files"
          >
            <span className="relative">
              <PaperclipIcon />
              {attachmentCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[0.5rem] font-medium leading-none text-primary-foreground">
                  {attachmentCount}
                </span>
              )}
            </span>
          </button>
        )}

        <ConfigureMenu
          open={configOpen}
          onOpenChange={onConfigOpenChange}
          activePanel={configActivePanel}
          onActivePanelChange={onConfigActivePanelChange}
          items={configureItems}
          renderPanel={renderConfigPanel}
          disabled={disabled}
        />

        {onStop ? (
          // Circular container (vs. Send's rounded-square) gives the square glyph
          // a proper home — the canonical stop affordance — and the shape morph
          // from Send→Stop signals the running state at a glance.
          <button
            type="button"
            onClick={onStop}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary-hover"
            aria-label="Stop generating"
            title="Stop"
          >
            {isStopping ? <SpinnerIcon /> : <StopIcon />}
          </button>
        ) : (
          <button
            type="button"
            disabled={!canSend}
            onClick={onSend}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-40"
            aria-label="Send message"
          >
            {isSubmitting ? <SpinnerIcon /> : <ArrowUpIcon />}
          </button>
        )}
      </div>
    </div>
  );
}
