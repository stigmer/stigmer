"use client";

import { cn } from "@stigmer/theme";
import { ContextPopover } from "./ContextPopover";
import { ConfigureMenu, type ConfigureMenuItem } from "./ConfigureMenu";
import { ModelSelector } from "../models/ModelSelector";
import { HarnessSelector } from "../models/HarnessSelector";
import type { HarnessOption } from "../models/harness";
import {
  PaperclipIcon,
  WorkspaceIcon,
  ArrowUpIcon,
  SpinnerIcon,
} from "./icons";

export interface ComposerToolbarProps {
  readonly disabled: boolean;
  readonly isSubmitting: boolean;
  readonly canSend: boolean;
  readonly onSend: () => void;

  // -- Tier 1: Workspace ----------------------------------------------------

  readonly showWorkspace: boolean;
  readonly workspaceCount: number;
  /** Pre-built workspace editor content for the popover. */
  readonly workspaceContent: React.ReactNode;

  // -- Tier 1: Attach -------------------------------------------------------

  readonly showAttach: boolean;
  readonly attachmentCount: number;
  readonly onAttachClick: () => void;

  // -- Tier 2: Configure menu -----------------------------------------------

  readonly configureItems: readonly ConfigureMenuItem[];
  readonly configOpen: boolean;
  readonly onConfigOpenChange: (open: boolean) => void;
  readonly configActivePanel: string | null;
  readonly onConfigActivePanelChange: (panel: string | null) => void;
  /** Render the picker content for a given configure panel id. */
  readonly renderConfigPanel: (itemId: string) => React.ReactNode;

  // -- Harness selector -----------------------------------------------------

  readonly showHarnessSelector: boolean;
  readonly harness?: HarnessOption;
  readonly onHarnessChange: (harness: HarnessOption) => void;

  // -- Model selector -------------------------------------------------------

  readonly showModelSelector: boolean;
  readonly modelId?: string;
  readonly onModelChange: (id: string) => void;
}

/**
 * Composer toolbar — Zone 3 of the SessionComposer.
 *
 * Renders a two-tier toolbar following the frequency-of-interaction principle:
 *
 * **Tier 1 (always visible):** Workspace, Attach
 * **Tier 2 (behind Configure menu):** Agent, MCP, Skills, Secrets
 * **Right edge:** Runner Picker, Model Selector, Send
 *
 * Workspace precedes Attach because it is the higher-signal context setter
 * (defines the codebase scope for the session). Attach is supplementary.
 *
 * Separators are placed between conceptual groups using Gestalt proximity.
 */
export function ComposerToolbar({
  disabled,
  isSubmitting,
  canSend,
  onSend,
  showAttach,
  attachmentCount,
  onAttachClick,
  showWorkspace,
  workspaceCount,
  workspaceContent,
  configureItems,
  configOpen,
  onConfigOpenChange,
  configActivePanel,
  onConfigActivePanelChange,
  renderConfigPanel,
  showHarnessSelector,
  harness,
  onHarnessChange,
  showModelSelector,
  modelId,
  onModelChange,
}: ComposerToolbarProps) {
  const hasTier1 = showAttach || showWorkspace;
  const hasTier2 = configureItems.length > 0;
  const showHarnessSeparate = showHarnessSelector && !showModelSelector;
  const hasExecParams = showHarnessSeparate || showModelSelector;

  return (
    <div className="flex items-center justify-between gap-2 border-t border-border-muted px-3 py-2">
      <div className="flex items-center gap-1.5">
        {/* ---- Tier 1: Input context (Workspace first, then Attach) ---- */}

        {showWorkspace && (
          <ContextPopover
            icon={<WorkspaceIcon />}
            label="Workspace"
            count={workspaceCount}
            disabled={disabled}
            hideLabel
          >
            {workspaceContent}
          </ContextPopover>
        )}

        {showAttach && (
          <button
            type="button"
            disabled={disabled}
            onClick={onAttachClick}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
            aria-label="Attach files"
          >
            <PaperclipIcon />
            <span className="max-sm:hidden">Attach</span>
            {attachmentCount > 0 && (
              <span className="rounded-full bg-primary-subtle px-1.5 text-[0.6rem] font-medium text-primary">
                {attachmentCount}
              </span>
            )}
          </button>
        )}

        {/* ---- Separator between Tier 1 and Tier 2 ---- */}

        {hasTier1 && hasTier2 && (
          <div className="mx-0.5 h-4 w-px bg-border/50" aria-hidden="true" />
        )}

        {/* ---- Tier 2: Agent configuration (behind Configure menu) ---- */}

        <ConfigureMenu
          open={configOpen}
          onOpenChange={onConfigOpenChange}
          activePanel={configActivePanel}
          onActivePanelChange={onConfigActivePanelChange}
          items={configureItems}
          renderPanel={renderConfigPanel}
          disabled={disabled}
        />

        {/* ---- Separator before execution parameters ---- */}

        {(hasTier1 || hasTier2) && hasExecParams && (
          <div className="mx-0.5 h-4 w-px bg-border/50" aria-hidden="true" />
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
            onHarnessChange={showHarnessSelector ? onHarnessChange : undefined}
            disabled={disabled}
          />
        )}
      </div>

      {/* ---- Send button ---- */}

      <button
        type="button"
        disabled={!canSend}
        onClick={onSend}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:pointer-events-none disabled:opacity-40"
        aria-label="Send message"
      >
        {isSubmitting ? <SpinnerIcon /> : <ArrowUpIcon />}
      </button>
    </div>
  );
}
