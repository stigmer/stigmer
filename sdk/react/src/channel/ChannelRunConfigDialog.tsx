"use client";

import { useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, type RunConfigInput } from "@stigmer/sdk";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { Button } from "../button/Button.js";
import { DialogShell } from "../internal/DialogShell.js";
import { ModelSelector } from "../models/ModelSelector.js";
import type { HarnessOption } from "../models/harness.js";
import {
  fromProtoServiceTier,
  toProtoServiceTier,
  type ServiceTierOption,
} from "../models/service-tier.js";
import {
  fromProtoThinkingMode,
  toProtoThinkingMode,
  type ThinkingModeOption,
} from "../models/thinking-mode.js";
import { agentChannelToInput, useSaveAgentChannel } from "./useSaveAgentChannel.js";

/** Props for {@link ChannelRunConfigDialog}. */
export interface ChannelRunConfigDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog requests an open-state change. */
  readonly onOpenChange: (open: boolean) => void;
  /** The channel whose run settings are edited. */
  readonly channel: AgentChannel;
  /** Called after a successful save (hosts typically pass `refetch`). */
  readonly onSaved?: () => void;
  /**
   * When `false`, renders as an in-flow open dialog instead of a
   * top-layer modal — for embedding in constrained surfaces
   * (documentation demos, visual tests). Interactive hosts keep the
   * default.
   * @default true
   */
  readonly modal?: boolean;
}

/**
 * Edits an installed channel's run settings (`AgentChannelSpec.run_config`)
 * — the console's first run_config editor (stigmer/stigmer#792), replacing
 * the Edit-YAML detour for the model pin the write-time validation guards
 * (stigmer/stigmer#774).
 *
 * Speaks the schedule form's vocabulary (DD-018 D-5): the model pin uses
 * the composer's own {@link ModelSelector} (with the fast-tier and
 * thinking switches, #357/#772) and the budget is the one run bound a
 * user owns; `max_tool_rounds` is an operator knob, API-reachable only —
 * preserved verbatim on save, never rendered.
 *
 * The harness dropdown is a browsing scope for the picker, initialized to
 * cursor (the platform's channel-serving default): channels carry no
 * per-channel harness — the serving harness is a platform property — and
 * the write-time model-pin validation judges the pin against any harness
 * section, so pinning under either scope is legitimate.
 *
 * Saves are full-input applies via {@link agentChannelToInput}, so the
 * agent reference, provider marker, credential bindings, and install
 * status all survive; clearing the model with no budget set is an
 * explicit reset to the platform defaults (`run_config` absent). Untouched
 * variant switches stay off the wire — unspecified-vs-explicit is a
 * load-bearing ledger distinction (#357).
 *
 * Built on the native `<dialog>` element, matching the SDK's modal
 * convention. Most hosts mount it via {@link AgentChannelsPanel}'s
 * channel card action.
 */
export function ChannelRunConfigDialog({
  open,
  onOpenChange,
  channel,
  onSaved,
  modal = true,
}: ChannelRunConfigDialogProps) {
  // Instance-scoped title id (oss#593): hosts legitimately mount this
  // dialog more than once per page; duplicate DOM ids would break the
  // aria-labelledby association for every copy after the first.
  const titleId = useId();

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      modal={modal}
      width="md"
      aria-labelledby={titleId}
    >
      {/* Body mounts only while open so its draft resets per session —
          reopening never resumes stale, unsaved edits. */}
      {open && (
        <ChannelRunConfigDialogBody
          channel={channel}
          onSaved={onSaved}
          onClose={handleClose}
          titleId={titleId}
        />
      )}
    </DialogShell>
  );
}

function ChannelRunConfigDialogBody({
  channel,
  onSaved,
  onClose,
  titleId,
}: {
  readonly channel: AgentChannel;
  readonly onSaved?: () => void;
  readonly onClose: () => void;
  /** Heading id minted by the outer dialog for its aria-labelledby. */
  readonly titleId: string;
}) {
  const channelName =
    channel.metadata?.name || channel.metadata?.slug || "this channel";
  const stored = channel.spec?.runConfig;

  const { save, isPending, error, clearError } = useSaveAgentChannel();

  const [modelName, setModelName] = useState(stored?.modelName ?? "");
  const [harness, setHarness] = useState<HarnessOption>("cursor");
  const [serviceTier, setServiceTier] = useState<ServiceTierOption>(
    fromProtoServiceTier(stored?.serviceTier) ?? "standard",
  );
  const [thinkingMode, setThinkingMode] = useState<ThinkingModeOption>(
    fromProtoThinkingMode(stored?.thinkingMode) ?? "disabled",
  );
  const [budgetUsd, setBudgetUsd] = useState(
    stored && stored.maxCostUsd > 0 ? String(stored.maxCostUsd) : "",
  );

  const handleSave = useCallback(async () => {
    try {
      // Full-input apply: only run_config changes. An all-empty draft
      // clears the block entirely — the proto's "empty = inherit" contract
      // (DD-018 D-2) — while `max_tool_rounds`, which this editor never
      // renders, survives verbatim (operator knob, DD-018 D-5).
      await save({
        ...agentChannelToInput(channel),
        runConfig: buildRunConfig(
          modelName,
          budgetUsd,
          serviceTier,
          thinkingMode,
          stored?.maxToolRounds ?? 0,
        ),
      });
      onSaved?.();
      onClose();
    } catch {
      // Surfaced through the hook's error state below.
    }
  }, [budgetUsd, channel, modelName, onClose, onSaved, save, serviceTier, stored, thinkingMode]);

  return (
    <div className="stg:flex stg:flex-col">
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3 stg:border-b stg:border-border stg:px-5 stg:py-4">
        <div className="stg:min-w-0">
          <h2
            id={titleId}
            className="stg:text-sm stg:font-semibold stg:text-foreground"
          >
            Run settings
          </h2>
          <p className="stg:mt-0.5 stg:truncate stg:text-xs stg:text-muted-foreground">
            {channelName}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className={cn(
            "stg:rounded stg:p-1 stg:text-muted-foreground",
            "stg:hover:bg-accent-hover stg:hover:text-foreground",
            "stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-ring",
          )}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="stg:space-y-4 stg:px-5 stg:py-4">
        {/* Engine & model — the composer's own picker (DD-018 D-5), the
            same shape as the schedule form's. Nothing is pinned until a
            model is picked. */}
        <div className="stg:space-y-1">
          <span className={labelClasses}>
            Model{" "}
            <span className="stg:font-normal stg:text-muted-foreground">(optional)</span>
          </span>
          <div className="stg:flex stg:items-center stg:gap-2">
            <ModelSelector
              value={modelName}
              onValueChange={setModelName}
              initialHarness={harness}
              onHarnessChange={setHarness}
              serviceTier={serviceTier}
              onServiceTierChange={setServiceTier}
              thinkingMode={thinkingMode}
              onThinkingModeChange={setThinkingMode}
              placeholderLabel="Platform default"
              disabled={isPending}
            />
            {modelName !== "" && (
              <button
                type="button"
                onClick={() => {
                  setModelName("");
                  setServiceTier("standard");
                  setThinkingMode("disabled");
                }}
                disabled={isPending}
                className={cn(
                  "stg:rounded-md stg:px-2 stg:py-1 stg:text-[0.65rem] stg:text-muted-foreground",
                  "stg:hover:text-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                )}
              >
                Reset to platform default
              </button>
            )}
          </div>
          <p className={hintClasses}>
            Every conversation turn on this channel runs the pinned model.
            Unpinned, the platform&rsquo;s default engine and model apply.
          </p>
        </div>

        {/* Budget — the one run bound that matters for an unattended
            surface (DD-018 D-5). Clamped by the platform profile;
            tool-round bounds stay API-only. */}
        <div className="stg:space-y-1">
          <label htmlFor={`${titleId}-budget`} className={labelClasses}>
            Budget per run (USD){" "}
            <span className="stg:font-normal stg:text-muted-foreground">(optional)</span>
          </label>
          <input
            id={`${titleId}-budget`}
            type="number"
            min="0"
            step="0.5"
            inputMode="decimal"
            value={budgetUsd}
            onChange={(e) => setBudgetUsd(e.target.value)}
            placeholder="Platform default"
            disabled={isPending}
            className={cn(inputClasses, "stg:max-w-40")}
          />
          <p className={hintClasses}>
            Caps each turn&rsquo;s estimated spend. The platform profile
            bounds this value; the lower cap wins.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="stg:rounded-md stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-3 stg:py-2 stg:text-xs stg:text-destructive"
          >
            {getUserMessage(error)}
          </div>
        )}
      </div>

      <div className="stg:flex stg:justify-end stg:gap-2 stg:border-t stg:border-border stg:px-5 stg:py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            clearError();
            onClose();
          }}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleSave()}
          disabled={isPending}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * Assemble the run_config the save writes. The schedule form's
 * `buildRunConfig` contract (#357/#772) plus the edit-surface rule from
 * the schedule detail view's `normalizeRunConfig`: fields this editor
 * does not own (`max_tool_rounds`) are preserved verbatim, and an
 * all-empty result clears the block ("empty = inherit").
 */
function buildRunConfig(
  modelName: string,
  budgetUsd: string,
  serviceTier: ServiceTierOption,
  thinkingMode: ThinkingModeOption,
  storedMaxToolRounds: number,
): RunConfigInput | undefined {
  const model = modelName.trim();
  const cost = Number.parseFloat(budgetUsd);

  const config: RunConfigInput = {};
  if (model !== "") config.modelName = model;
  if (Number.isFinite(cost) && cost > 0) config.maxCostUsd = cost;
  if (storedMaxToolRounds > 0) config.maxToolRounds = storedMaxToolRounds;
  // Carried only when the user actively chose the variant AND pinned a
  // model (both are per-model; the server refuses them without one). An
  // untouched switch stays absent — unspecified-vs-explicit is a
  // load-bearing ledger distinction (#357/#772).
  if (serviceTier === "fast" && model !== "") {
    config.serviceTier = toProtoServiceTier(serviceTier);
  }
  if (thinkingMode === "enabled" && model !== "") {
    config.thinkingMode = toProtoThinkingMode(thinkingMode);
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

const labelClasses = "stg:block stg:text-xs stg:font-medium stg:text-foreground";

const hintClasses = "stg:text-[0.65rem] stg:text-muted-foreground";

const inputClasses = cn(
  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="m3 3 8 8M11 3l-8 8" />
    </svg>
  );
}
