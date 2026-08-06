"use client";

import { useCallback, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import {
  getUserMessage,
  type ResourceRef,
  type RunConfigInput,
} from "@stigmer/sdk";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { Popover } from "@base-ui/react/popover";
import { AgentPicker } from "../agent/AgentPicker.js";
import { EnvironmentPicker } from "../environment/EnvironmentPicker.js";
import { useGitHubConnection } from "../github/useGitHubConnection.js";
import { ModelSelector } from "../models/ModelSelector.js";
import { toProtoHarness, type HarnessOption } from "../models/harness.js";
import { Switch } from "../switch/Switch.js";
import { useStigmerPortalContainer } from "../portal-container.js";
import { useWorkspaceEntries } from "../workspace/useWorkspaceEntries.js";
import { WorkspaceEditor } from "../workspace/WorkspaceEditor.js";
import { CadenceField } from "./CadenceField.js";
import { TimeZoneField, browserTimeZone } from "./TimeZoneField.js";
import { useCreateSchedule } from "./useCreateSchedule.js";
import { cadenceToCron, validateCron, type CadencePreset } from "./cadence.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link ScheduleForm}. */
export interface ScheduleFormProps {
  /**
   * Organization slug. Schedules are org-local: the server requires the
   * target agent to live in this same org, so the agent picker is
   * locked to org scope.
   */
  readonly org: string;
  /** Fired with the created schedule after a successful submit. */
  readonly onComplete?: (schedule: Schedule) => void;
  /** Fired when the user cancels. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root form element. */
  readonly className?: string;
}

/** invocation.proto pins AgentInvocation.message to 8192 characters. */
const MESSAGE_MAX_LEN = 8192;
/** Show the remaining-characters counter once within this margin. */
const MESSAGE_COUNTER_THRESHOLD = 500;

/**
 * Single-page form for creating a {@link Schedule}.
 *
 * The form speaks the composer's vocabulary (DD-018 D-5): a schedule is
 * a saved run — which agent, what message, what workspace, which
 * engine and model, what budget — plus a cadence. It reuses the
 * composer's own pickers ({@link ModelSelector}, {@link WorkspaceEditor})
 * so the interactive and scheduled surfaces cannot drift, minus only
 * what unattended makes impossible (no local folders, no attachments,
 * no approval-mode choice).
 *
 * Enabled defaults to OFF, deliberately: it matches the proto/YAML
 * default (an omitted `enabled` is false) and the platform's
 * recommended workflow — create staged-disabled, validate with
 * "Run now" on the detail page, then enable.
 *
 * Creation only. Editing an existing schedule must not flow through
 * this form's curated input — see the note on {@link useCreateSchedule}.
 *
 * @example
 * ```tsx
 * <ScheduleForm
 *   org="acme"
 *   onComplete={(s) => navigate(`/library/schedules/${s.metadata?.org}/${s.metadata?.slug}`)}
 *   onCancel={() => navigate("/library/schedules")}
 * />
 * ```
 */
export function ScheduleForm({
  org,
  onComplete,
  onCancel,
  className,
}: ScheduleFormProps) {
  const { create, isCreating, error, clearError } = useCreateSchedule();

  const [name, setName] = useState("");
  const [agentRef, setAgentRef] = useState<ResourceRef | null>(null);
  const [agentName, setAgentName] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [cadence, setCadence] = useState<CadencePreset>({
    kind: "daily",
    hour: 9,
    minute: 0,
  });
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const [enabled, setEnabled] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [environmentRefs, setEnvironmentRefs] = useState<ResourceRef[]>([]);

  // Engine & model are one atomic choice: picking a model pins BOTH the
  // harness and the model (the registry scopes models per harness, so a
  // model without its harness is meaningless). Empty model = nothing
  // pinned = the platform defaults apply to both. Browsing harnesses in
  // the popover without picking a model pins nothing.
  const [modelName, setModelName] = useState("");
  const [modelHarness, setModelHarness] = useState<HarnessOption>("cursor");

  const [budgetUsd, setBudgetUsd] = useState("");

  // Workspace the fresh per-fire session clones — git sources only
  // (write-time validated server-side: no client is connected at fire
  // time to serve a local folder). The GitHub repo picker lights up
  // when the user already has a connection; otherwise the editor's
  // manual URL+branch input applies, with no OAuth flow forced into
  // this form.
  const workspace = useWorkspaceEntries();
  const gitHub = useGitHubConnection(org);

  const trimmedName = name.trim();
  const trimmedMessage = message.trim();
  const cron = cadenceToCron(cadence).trim();
  const cronValid = cron !== "" && validateCron(cron) === null;

  const canSubmit =
    trimmedName !== "" &&
    agentRef !== null &&
    trimmedMessage !== "" &&
    cronValid &&
    !isCreating;

  const handleAgentChange = useCallback((ref: ResourceRef | null) => {
    setAgentRef(ref);
    if (ref === null) setAgentName(null);
    setPickerOpen(false);
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit || !agentRef) return;

      clearError();
      const runConfig = buildRunConfig(modelName, budgetUsd);
      try {
        const schedule = await create({
          name: trimmedName,
          org,
          cron,
          timeZone,
          enabled,
          agent: {
            agentRef,
            message: trimmedMessage,
            // The harness travels with the model it was picked under;
            // no model means no harness — the platform defaults apply.
            ...(modelName !== ""
              ? { harness: toProtoHarness(modelHarness) }
              : {}),
            ...(workspace.hasEntries
              ? { workspaceEntries: workspace.toInput() }
              : {}),
            ...(environmentRefs.length > 0 ? { environmentRefs } : {}),
            ...(runConfig ? { runConfig } : {}),
          },
        });
        onComplete?.(schedule);
      } catch {
        // error state is managed by useCreateSchedule
      }
    },
    [
      canSubmit,
      agentRef,
      clearError,
      create,
      trimmedName,
      org,
      cron,
      timeZone,
      enabled,
      trimmedMessage,
      environmentRefs,
      modelName,
      modelHarness,
      budgetUsd,
      workspace,
      onComplete,
    ],
  );

  const remaining = MESSAGE_MAX_LEN - message.length;

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("max-w-2xl space-y-5", className)}
      aria-label="New schedule"
    >
      {/* Name */}
      <div className="space-y-1">
        <label htmlFor="stgm-new-schedule-name" className={labelClasses}>
          Name
        </label>
        <input
          id="stgm-new-schedule-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. daily-fee-reminders"
          disabled={isCreating}
          autoFocus
          required
          className={inputClasses}
        />
      </div>

      {/* Target agent */}
      <div className="space-y-1">
        <span id="stgm-new-schedule-agent-label" className={labelClasses}>
          Agent to run
        </span>
        <Popover.Root open={pickerOpen} onOpenChange={setPickerOpen}>
          <Popover.Trigger
            disabled={isCreating}
            aria-labelledby="stgm-new-schedule-agent-label"
            className={cn(
              "flex w-full items-center justify-between rounded-md border border-input bg-background px-2.5 py-1.5 text-left text-xs",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
              agentRef ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span className="truncate">
              {agentRef
                ? (agentName ?? `${agentRef.org}/${agentRef.slug}`)
                : "Choose an agent…"}
            </span>
            <ChevronIcon />
          </Popover.Trigger>
          <AgentPickerPopup
            org={org}
            value={agentRef}
            onChange={handleAgentChange}
            onDisplayNameResolved={(_key, resolvedName) =>
              setAgentName(resolvedName)
            }
            disabled={isCreating}
          />
        </Popover.Root>
        <p className={hintClasses}>
          Each fire runs this agent unattended in a fresh session. Only
          agents in <span className="font-medium">{org}</span> can be
          scheduled.
        </p>
      </div>

      {/* Message */}
      <div className="space-y-1">
        <label htmlFor="stgm-new-schedule-message" className={labelClasses}>
          Message
        </label>
        <textarea
          id="stgm-new-schedule-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="The instruction the agent receives on every fire — write it for a run with no human present."
          disabled={isCreating}
          required
          rows={5}
          maxLength={MESSAGE_MAX_LEN}
          className={cn(inputClasses, "resize-y")}
        />
        {remaining <= MESSAGE_COUNTER_THRESHOLD && (
          <p className={hintClasses}>{remaining} characters left</p>
        )}
      </div>

      {/* Workspace — what each fire's fresh session operates on
          (DD-018 D-4). Git sources only; the server refuses local
          folders at write time because no client is connected when a
          schedule fires. */}
      <div className="space-y-1">
        <span className={labelClasses}>
          Workspace{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <WorkspaceEditor
          workspace={workspace}
          gitHubConnection={gitHub.isConnected ? gitHub : undefined}
          enableGitHub
          enableLocal={false}
          disabled={isCreating}
        />
        <p className={hintClasses}>
          Each run clones these repositories fresh. Private repositories need
          a <code className="font-mono">GITHUB_TOKEN</code> in one of this
          schedule&rsquo;s environments; public ones need nothing.
        </p>
      </div>

      {/* Environments — how a tool-using agent becomes schedulable
          (DD-017 D-2). Only org-shared environments resolve for a
          schedule fire, so the picker is filtered to visibility_org —
          the same credential surface a channel binding uses. */}
      <div className="space-y-1">
        <span id="stgm-new-schedule-env-label" className={labelClasses}>
          Environments <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <EnvironmentPicker
          org={org}
          value={environmentRefs}
          onChange={setEnvironmentRefs}
          disabled={isCreating}
          filterEnvironment={(env) =>
            env.metadata?.visibility === ApiResourceVisibility.visibility_org
          }
        />
        <p className={hintClasses}>
          Bind org-shared credentials (for example an MCP server&rsquo;s secret)
          so the agent&rsquo;s tools work on an unattended fire. Without this, an
          agent whose tools need credentials will be refused every run.
        </p>
      </div>

      {/* Cadence */}
      <div className="space-y-1">
        <span className={labelClasses}>Runs</span>
        <CadenceField
          value={cadence}
          onChange={setCadence}
          timeZone={timeZone}
          disabled={isCreating}
        />
      </div>

      {/* Engine & model — the composer's own picker (DD-018 D-5),
          replacing the free-text model box whose typos surfaced as
          fire-time failures. Nothing is pinned until a model is picked. */}
      <div className="space-y-1">
        <span className={labelClasses}>
          Engine &amp; model{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </span>
        <div className="flex items-center gap-2">
          <ModelSelector
            value={modelName}
            onValueChange={setModelName}
            initialHarness={modelHarness}
            onHarnessChange={setModelHarness}
            placeholderLabel="Platform default"
            disabled={isCreating}
          />
          {modelName !== "" && (
            <button
              type="button"
              onClick={() => setModelName("")}
              disabled={isCreating}
              className={cn(
                "rounded-md px-2 py-1 text-[0.65rem] text-muted-foreground",
                "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              Reset to platform default
            </button>
          )}
        </div>
        <p className={hintClasses}>
          Runs use the platform&rsquo;s default engine and model unless you
          pick one here. Picking a model pins the engine it belongs to.
        </p>
      </div>

      {/* Budget — the one run bound that matters for an unattended
          surface: nobody is watching a 3 AM fire (DD-018 D-5). Clamped
          by the platform profile; tool-round bounds stay API-only. */}
      <div className="space-y-1">
        <label htmlFor="stgm-new-schedule-budget" className={labelClasses}>
          Budget per run (USD){" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <input
          id="stgm-new-schedule-budget"
          type="number"
          min="0"
          step="any"
          value={budgetUsd}
          onChange={(e) => setBudgetUsd(e.target.value)}
          placeholder="platform default"
          disabled={isCreating}
          className={cn(inputClasses, "sm:max-w-48")}
        />
        <p className={hintClasses}>
          Each run stops when it reaches this spend. You can lower the
          platform&rsquo;s per-run cap, never raise it past the
          platform&rsquo;s ceiling.
        </p>
      </div>

      {/* Time zone */}
      <div className="space-y-1">
        <label htmlFor="stgm-new-schedule-tz" className={labelClasses}>
          Time zone
        </label>
        <TimeZoneField
          id="stgm-new-schedule-tz"
          value={timeZone}
          onChange={setTimeZone}
          disabled={isCreating}
        />
      </div>

      {/* Enabled */}
      <div className="flex items-start gap-3">
        <Switch
          id="stgm-new-schedule-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={isCreating}
          aria-labelledby="stgm-new-schedule-enabled-label"
        />
        <div className="space-y-0.5">
          <label
            id="stgm-new-schedule-enabled-label"
            htmlFor="stgm-new-schedule-enabled"
            className={labelClasses}
          >
            Enabled
          </label>
          <p className={hintClasses}>
            Leave off to create the schedule staged: validate it with
            &ldquo;Run now&rdquo; on the schedule page, then enable it there.
          </p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon />}
          Create schedule
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm",
              "text-muted-foreground hover:bg-accent-hover hover:text-foreground",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

const labelClasses = "block text-xs font-medium text-foreground";
const hintClasses = "text-[0.65rem] text-muted-foreground";

/**
 * Assemble a {@link RunConfigInput} from the model choice and budget, or
 * `undefined` when both are unset — an all-empty run_config carries no
 * meaning, and omitting it keeps the schedule on the platform defaults
 * (the server's own "empty = inherit" contract, DD-017 D-3 as carried
 * into DD-018 D-2). Non-numeric or negative budgets are dropped rather
 * than sent; the proto's `gte = 0` constraint would reject them anyway,
 * and a blank field must not become a zero override. `max_tool_rounds`
 * is deliberately not collected here — an implementation knob, not a
 * user concept; API-reachable for operators (DD-018 D-5).
 */
function buildRunConfig(
  modelName: string,
  budgetUsd: string,
): RunConfigInput | undefined {
  const model = modelName.trim();
  const cost = Number.parseFloat(budgetUsd);

  const config: RunConfigInput = {};
  if (model !== "") config.modelName = model;
  if (Number.isFinite(cost) && cost > 0) config.maxCostUsd = cost;

  return Object.keys(config).length > 0 ? config : undefined;
}
const inputClasses = cn(
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
  "placeholder:text-muted-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-50",
);

function AgentPickerPopup({
  org,
  value,
  onChange,
  onDisplayNameResolved,
  disabled,
}: {
  readonly org: string;
  readonly value: ResourceRef | null;
  readonly onChange: (ref: ResourceRef | null) => void;
  readonly onDisplayNameResolved: (key: string, name: string) => void;
  readonly disabled?: boolean;
}) {
  const portalContainer = useStigmerPortalContainer();
  return (
    <Popover.Portal container={portalContainer}>
      <Popover.Positioner sideOffset={4} align="start">
        <Popover.Popup
          className={cn(
            "z-popover overflow-x-hidden overflow-y-auto rounded-lg border border-border",
            "bg-popover p-3 text-popover-foreground shadow-md",
            "max-h-[60vh]",
          )}
        >
          <AgentPicker
            org={org}
            value={value}
            onChange={onChange}
            onDisplayNameResolved={onDisplayNameResolved}
            // Schedules are org-local: the server rejects a target
            // agent outside the schedule's org, so cross-org browsing
            // could only offer choices that fail at submit.
            scope="org"
            showScopeToggle={false}
            disabled={disabled}
          />
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
