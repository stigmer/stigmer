"use client";

import { useId } from "react";
import { cn } from "@stigmer/design-tokens";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../internal/tooltip.js";
import { ContextPopover } from "./ContextPopover.js";
import { ConfigureMenu, type ConfigureMenuItem } from "./ConfigureMenu.js";
import { ModelSelector, type InheritedModel } from "../models/ModelSelector.js";
import { HarnessSelector } from "../models/HarnessSelector.js";
import type { HarnessOption } from "../models/harness.js";
import type { ServiceTierOption } from "../models/service-tier.js";
import type { ThinkingModeOption } from "../models/thinking-mode.js";
import type { ModelReadinessLookup } from "../models/readiness.js";
import { InteractionModePicker, type InteractionModeOption } from "./InteractionModePicker.js";
import {
  PaperclipIcon,
  WorkspaceIcon,
  ArrowUpIcon,
  StopIcon,
} from "./icons.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

export interface ComposerToolbarProps {
  readonly disabled: boolean;
  readonly isSubmitting: boolean;
  readonly canSend: boolean;
  /**
   * Why Send is held though the message could be sent (the chosen model
   * cannot run here yet). The disabled Send button carries it as its
   * accessible description.
   */
  readonly sendBlockedReason?: string;
  readonly onSend: () => void;
  /**
   * When provided, the primary button becomes a Stop control (enabled even
   * while the rest of the composer is disabled) while nothing can be sent;
   * once a message can be, it is the Send button again, and the message
   * waits for the working turn. Driven by the active run being stoppable.
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
  /**
   * The model the send inherits while `modelId` is empty (the agent's run
   * defaults): the picker names it as "Agent default: <model>".
   */
  readonly inheritedModel?: InheritedModel;
  /** Chooses {@link inheritedModel} back; lists it in the picker as an entry. */
  readonly onInheritedModelSelect?: () => void;
  readonly onModelChange: (id: string) => void;
  /** Each model's readiness here, for the picker's "Needs an Anthropic key" marks. */
  readonly modelReadinessOf?: ModelReadinessLookup;
  /** Current service tier for the selected model (#357). */
  readonly serviceTier?: ServiceTierOption;
  /** Enables the fast-tier switch inside the model selector's options area. */
  readonly onServiceTierChange?: (tier: ServiceTierOption) => void;
  /** Current thinking mode for the selected model (#772). */
  readonly thinkingMode?: ThinkingModeOption;
  /** Enables the thinking switch inside the model selector's options area. */
  readonly onThinkingModeChange?: (mode: ThinkingModeOption) => void;

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
  readonly fileCount: number;
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
  sendBlockedReason,
  onSend,
  onStop,
  isStopping = false,
  showAttach,
  fileCount,
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
  inheritedModel,
  onInheritedModelSelect,
  onModelChange,
  modelReadinessOf,
  serviceTier,
  onServiceTierChange,
  thinkingMode,
  onThinkingModeChange,
}: ComposerToolbarProps) {
  const sendBlockedId = useId();
  const showHarnessSeparate = showHarnessSelector && !showModelSelector;

  return (
    // A named container: the controls size to the composer's width, not the
    // viewport's, so a 390-pixel panel or popup on a wide screen narrows
    // them too (stigmer#2709).
    <div className="stg:@container/composer-toolbar stg:flex stg:items-center stg:justify-between stg:gap-2 stg:border-t stg:border-border-muted stg:px-3 stg:py-2">
      {/* ---- Left group: Primary state (Mode + Model) ---- */}

      <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-1.5">
        {showInteractionModePicker && (
          <InteractionModePicker
            value={interactionMode ?? "agent"}
            onValueChange={onInteractionModeChange}
            disabled={disabled}
          />
        )}

        {showHarnessSeparate && (
          <HarnessSelector
            value={harness ?? "stigmer"}
            onValueChange={onHarnessChange}
            disabled={disabled}
          />
        )}

        {showModelSelector && (
          <ModelSelector
            value={modelId}
            inheritedModel={inheritedModel}
            onInheritedModelSelect={onInheritedModelSelect}
            onValueChange={onModelChange}
            harness={showHarnessSelector ? undefined : harness}
            initialHarness={showHarnessSelector ? harness : undefined}
            onHarnessChange={showHarnessSelector ? onHarnessChange : undefined}
            serviceTier={serviceTier}
            onServiceTierChange={onServiceTierChange}
            thinkingMode={thinkingMode}
            onThinkingModeChange={onThinkingModeChange}
            readinessOf={modelReadinessOf}
            disabled={disabled}
          />
        )}

      </div>

      {/* ---- Right group: Secondary actions (icon-only) + Send ----

          Icon-only actions carry house tooltips (never native `title` —
          OS-delayed and unreachable from keyboard/touch, dead entirely on
          disabled controls). Disabled-capable buttons put the trigger on a
          plain wrapper span: `disabled` adds `pointer-events-none`, so the
          span, not the button, must own the hover for the tooltip to keep
          working while disabled. The provider is context-only (no DOM node)
          and groups the buttons' hover delay. */}

      <TooltipProvider>
        <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1">
          {showWorkspace && (
            onWorkspaceDirectAction
              ? <Tooltip>
                  <TooltipTrigger render={<span className="stg:inline-flex" />}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={onWorkspaceDirectAction}
                      className={cn(
                        "stg:inline-flex stg:h-8 stg:w-8 stg:items-center stg:justify-center stg:rounded-md stg:text-xs stg:transition-colors",
                        "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
                        "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                      )}
                      aria-label="Workspace"
                    >
                      <span className="stg:relative">
                        <WorkspaceIcon />
                        {workspaceCount > 0 && (
                          <span className="stg:absolute stg:-right-1.5 stg:-top-1.5 stg:flex stg:h-3.5 stg:min-w-3.5 stg:items-center stg:justify-center stg:rounded-full stg:bg-primary stg:px-0.5 stg:text-2xs stg:font-medium stg:leading-none stg:text-primary-foreground">
                            {workspaceCount}
                          </span>
                        )}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Workspace</TooltipContent>
                </Tooltip>
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
            <Tooltip>
              <TooltipTrigger render={<span className="stg:inline-flex" />}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onAttachClick}
                  className={cn(
                    "stg:inline-flex stg:h-8 stg:w-8 stg:items-center stg:justify-center stg:rounded-md stg:text-xs stg:transition-colors",
                    "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
                    "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                  )}
                  aria-label="Attach files"
                >
                  <span className="stg:relative">
                    <PaperclipIcon />
                    {fileCount > 0 && (
                      <span className="stg:absolute stg:-right-1.5 stg:-top-1.5 stg:flex stg:h-3.5 stg:min-w-3.5 stg:items-center stg:justify-center stg:rounded-full stg:bg-primary stg:px-0.5 stg:text-2xs stg:font-medium stg:leading-none stg:text-primary-foreground">
                        {fileCount}
                      </span>
                    )}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Attach files</TooltipContent>
            </Tooltip>
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

          {onStop && !canSend ? (
            // Circular container (vs. Send's rounded-square) gives the square glyph
            // a proper home — the canonical stop affordance — and the shape morph
            // from Send→Stop signals the running state at a glance. Always
            // enabled, so the button itself is the tooltip trigger (keyboard
            // focus opens it too).
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    onClick={onStop}
                    className="stg:flex stg:h-8 stg:w-8 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-primary stg:text-primary-foreground stg:transition-colors stg:hover:bg-primary-hover"
                    aria-label="Stop generating"
                  />
                }
              >
                {isStopping ? <SpinnerIcon /> : <StopIcon />}
              </TooltipTrigger>
              <TooltipContent side="top">Stop</TooltipContent>
            </Tooltip>
          ) : (
            <>
              <button
                type="button"
                disabled={!canSend}
                onClick={onSend}
                className="stg:flex stg:h-8 stg:w-8 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-lg stg:bg-primary stg:text-primary-foreground stg:transition-colors stg:hover:bg-primary-hover stg:disabled:pointer-events-none stg:disabled:opacity-40"
                aria-label="Send message"
                aria-describedby={sendBlockedReason === undefined ? undefined : sendBlockedId}
              >
                {isSubmitting ? <SpinnerIcon /> : <ArrowUpIcon />}
              </button>
              {sendBlockedReason !== undefined && (
                <span id={sendBlockedId} className="stg:sr-only">
                  {sendBlockedReason}
                </span>
              )}
            </>
          )}
        </div>
      </TooltipProvider>
    </div>
  );
}
