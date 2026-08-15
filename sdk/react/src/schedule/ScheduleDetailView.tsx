"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { InlineEditTextarea } from "../inline-edit/InlineEditTextarea.js";
import { EditResourceYamlDialog } from "../manifest/EditResourceYamlDialog.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell.js";
import { Section } from "../resource-detail/Section.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { useCopyResource } from "../resource-detail/useCopyResource.js";
import { useDeleteResource } from "../resource-detail/useDeleteResource.js";
import { useDetailTabs } from "../resource-detail/useDetailTabs.js";
import type {
  AdditionalTab,
  DetailAction,
  ResourceHeaderMeta,
} from "../resource-detail/types.js";
import type { TabItem } from "../tabs/Tabs.js";
import { useExportResource } from "../library/useExportResource.js";
import { ScheduleRunOutcome } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import type { ScheduleSpec } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/spec_pb";
import {
  RunConfigSchema,
  type AgentInvocation,
  type RunConfig,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/invocation_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import {
  cadenceToCron,
  cronToCadence,
  describeCadence,
  validateCron,
  type CadencePreset,
} from "./cadence.js";
import { CadenceField } from "./CadenceField.js";
import { EnvironmentPicker } from "../environment/EnvironmentPicker.js";
import { ModelSelector } from "../models/ModelSelector.js";
import {
  HARNESS_META,
  fromProtoHarness,
  toProtoHarness,
  type HarnessOption,
} from "../models/harness.js";
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
import { deriveScheduleState, formatNextFire } from "./scheduleState.js";
import {
  ScheduleRunsCompactList,
  ScheduleRunsTable,
} from "./ScheduleRunsTable.js";
import { TimeZoneField, browserTimeZone } from "./TimeZoneField.js";
import { useSchedule } from "./useSchedule.js";
import { useScheduleRuns } from "./useScheduleRuns.js";
import { useResumeSchedule } from "./useResumeSchedule.js";
import { useSetScheduleEnabled } from "./useSetScheduleEnabled.js";
import { useTriggerSchedule } from "./useTriggerSchedule.js";
import { useUpdateScheduleSpec } from "./useUpdateScheduleSpec.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link ScheduleDetailView}. */
export interface ScheduleDetailViewProps {
  /** Organization slug. */
  readonly org: string;
  /** Schedule slug. */
  readonly slug: string;
  /**
   * Called when the user activates the target-agent reference.
   * Navigation is the consumer's concern (DD-004) — the Console pushes
   * a Library route; an embedding host does whatever fits.
   */
  readonly onNavigateToAgent?: (org: string, slug: string) => void;
  /**
   * Called when the user activates an execution reference (`aex_…`),
   * from the status row or a run-history row. When omitted, ids render
   * as plain text.
   */
  readonly onNavigateToExecution?: (executionId: string) => void;
  /** Called after a successful delete (navigate back to the list). */
  readonly onDeleted?: () => void;
  /** Called when the schedule loads or reloads (e.g. breadcrumb label sync). */
  readonly onResourceLoad?: (schedule: Schedule) => void;
  /**
   * Enable inline editing of the schedule's mutable spec fields
   * (cadence, message, environments, engine & model, budget). Each
   * field saves independently via a lossless full-resource re-apply
   * ({@link useUpdateScheduleSpec}). The server-immutable fields —
   * slug, target agent, target type — never gain an edit affordance;
   * workspace edits go through Edit YAML for now.
   * @default false
   */
  readonly editable?: boolean;
  /** Consumer-provided extension tabs, appended after the built-ins. */
  readonly additionalTabs?: readonly AdditionalTab[];
  /** Controlled active tab (pair with `onTabChange`). */
  readonly activeTab?: string;
  /** Controlled tab change handler (pair with `activeTab`). */
  readonly onTabChange?: (tabId: string) => void;
  /** Initial tab in uncontrolled mode. @default "overview" */
  readonly defaultTab?: string;
  /**
   * The instant "next fire" countdowns and run timestamps are computed
   * against. Injectable for deterministic tests and Scenar fixtures.
   * @default new Date() at render
   */
  readonly now?: Date;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

const OVERVIEW_TAB_ID = "overview";
const RUNS_TAB_ID = "runs";

// The Overview strip shows the newest handful of fires; the Runs tab
// owns the full paginated history.
const RECENT_RUNS_OPTIONS = { pageSize: 5 } as const;

/** invocation.proto pins AgentInvocation.message to 8192 characters. */
const MESSAGE_MAX_LEN = 8192;

/**
 * Self-contained detail view for a Schedule (stigmer/stigmer#352),
 * split into an Overview tab (definition + status + recent runs) and a
 * Runs tab (the full paginated fire ledger).
 *
 * The view's one non-negotiable is rendering the two stop-levers
 * distinctly, each with its inline remedy:
 *
 * - **Disabled** (owner's `spec.enabled` switch) — banner with an
 *   Enable action (a lossless full-proto re-apply).
 * - **Paused** (platform's failure-streak latch,
 *   `status.paused_reason`) — banner showing the reason with a Resume
 *   action (the one path that clears the pause).
 *
 * Trigger ("Run now") starts a real, billable execution and is gated
 * behind a confirmation; it is disabled while the schedule cannot fire
 * (the banner names the remedy). With `editable`, the mutable spec
 * fields edit inline; Edit YAML, Export, and Delete round out the
 * action set.
 *
 * Handles loading, error, and not-found states automatically.
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 */
export function ScheduleDetailView({
  org,
  slug,
  onNavigateToAgent,
  onNavigateToExecution,
  onDeleted,
  onResourceLoad,
  editable = false,
  additionalTabs,
  activeTab,
  onTabChange,
  defaultTab,
  now,
  className,
}: ScheduleDetailViewProps) {
  const { schedule, isLoading, error, refetch } = useSchedule(org, slug);

  // The recent-runs fetch stays mounted regardless of the active tab:
  // it feeds the Runs tab badge (total count), the Overview strip, and
  // post-trigger freshness. The Runs tab's full table owns its own
  // paginated fetch inside ScheduleRunsTable.
  const {
    runs: recentRuns,
    totalCount: totalRunCount,
    isLoading: recentRunsLoading,
    refetch: refetchRecentRuns,
  } = useScheduleRuns(schedule?.metadata?.id ?? null, RECENT_RUNS_OPTIONS);

  const { resumeSchedule, isResuming } = useResumeSchedule();
  const { triggerSchedule, isTriggering } = useTriggerSchedule();
  const { setEnabled, isPending: isToggling } = useSetScheduleEnabled();
  const { updateSpec, isUpdating } = useUpdateScheduleSpec();
  const { deleteResource, isDeleting } = useDeleteResource(
    "schedule",
    schedule?.metadata?.id ?? null,
    schedule?.metadata?.name,
  );
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const [editOpen, setEditOpen] = useState(false);

  // Remount key for the Runs tab's table: a manual trigger bumps it so
  // the table refetches and returns to page 1, where the new fire
  // appears (the key-remount reset idiom, DD-014).
  const [runsVersion, setRunsVersion] = useState(0);

  // Last failed inline save, attributed to the field that was edited so
  // only that editor shows the message. The backend's message is the
  // UX (DD-006) — e.g. the cron validator's copy surfaces verbatim.
  const [saveError, setSaveError] = useState<{
    field: string;
    message: string;
  } | null>(null);

  const saveSpecField = useCallback(
    async (
      field: string,
      mutate: (spec: ScheduleSpec) => void,
    ): Promise<boolean> => {
      if (!schedule) return false;
      setSaveError(null);
      try {
        await updateSpec(schedule, mutate);
        refetch();
        return true;
      } catch (err) {
        setSaveError({
          field,
          message: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
    [schedule, updateSpec, refetch],
  );

  const builtInTabs = useMemo<readonly TabItem[]>(
    () => [
      { id: OVERVIEW_TAB_ID, label: "Overview" },
      {
        id: RUNS_TAB_ID,
        label: "Runs",
        ...(totalRunCount > 0 ? { badge: totalRunCount } : {}),
      },
    ],
    [totalRunCount],
  );

  const {
    effectiveTabs,
    effectiveActiveTab,
    effectiveOnTabChange,
    activeAdditionalTab,
  } = useDetailTabs({
    builtInTabs,
    additionalTabs,
    activeTab,
    onTabChange,
    defaultTab,
  });

  const { copyYaml, downloadYaml } = useExportResource({
    kind: "Schedule",
    resource: schedule,
  });

  useEffect(() => {
    if (schedule) onResourceLoad?.(schedule);
  }, [schedule, onResourceLoad]);

  if (isLoading) return <LoadingSkeleton className={className} />;
  if (error)
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (!schedule) return <NotFoundState className={className} />;

  const meta = schedule.metadata;
  const spec = schedule.spec;
  const status = schedule.status;
  const specAudit = status?.audit?.specAudit;
  const stateInfo = deriveScheduleState(spec, status);
  const renderNow = now ?? new Date();

  const scheduleId = meta?.id ?? "";
  const scheduleOrg = meta?.org || org;
  const target = spec?.target?.case === "agent" ? spec.target.value : undefined;

  const handleResume = async () => {
    await resumeSchedule(scheduleId);
    refetch();
  };

  const handleToggleEnabled = async () => {
    await setEnabled(schedule, !spec?.enabled);
    refetch();
  };

  // One fire: trigger, refresh the schedule and its run history, and — on
  // a started run — hand the execution to the host so it can navigate
  // straight to it (the whole point of the synchronous trigger, DD-017
  // D-6). A refused run resolves too; its reason is toasted by the hook
  // and lands in the run history below.
  const fireNow = async () => {
    const result = await triggerSchedule(scheduleId);
    refetch();
    refetchRecentRuns();
    setRunsVersion((v) => v + 1);
    if (
      result.outcome === ScheduleRunOutcome.STARTED &&
      result.executionId &&
      onNavigateToExecution
    ) {
      onNavigateToExecution(result.executionId);
    }
  };

  const handleTrigger = async () => {
    const confirmed = await confirm({
      title: "Run this schedule now?",
      description:
        "This starts a real agent execution immediately, outside the cron " +
        "cadence. The run is recorded in this schedule's run history.",
      confirmLabel: "Start run",
      variant: "default",
    });
    if (!confirmed) return;
    await fireNow();
  };

  // A disabled schedule refuses to fire at the server — ScheduleBlueprintAccess
  // requires spec.enabled at the create gate AND the mid-run read (DD-017
  // D-5), so a disabled run would die mid-execution after billing. The
  // staged-disabled test flow the creation form promises is therefore
  // "enable, then fire", and this makes it one click.
  const handleEnableAndRun = async () => {
    const confirmed = await confirm({
      title: "Enable and run this schedule now?",
      description:
        "This schedule is staged disabled. Enabling it lets it fire on its " +
        "cron cadence going forward, and starts one real run immediately so " +
        "you can see the result. You can disable it again afterwards.",
      confirmLabel: "Enable & run",
      variant: "default",
    });
    if (!confirmed) return;
    await setEnabled(schedule, true);
    await fireNow();
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: "Delete this schedule?",
      description:
        `"${meta?.name ?? slug}" will stop firing and be permanently ` +
        "removed. Past executions are not affected. This cannot be undone.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!confirmed) return;
    await deleteResource();
    onDeleted?.();
  };

  // Disabled → "Enable & run now" (the one-click staged-test flow);
  // active and paused → "Run now" (a paused schedule's owner needs a
  // test fire to verify a fix before resuming — DD-017 D-5).
  const primaryAction: DetailAction =
    stateInfo.state === "disabled"
      ? {
          id: "enable-and-run",
          label: "Enable & run now",
          onAction: () => void handleEnableAndRun(),
          disabled: isTriggering || isToggling,
        }
      : {
          id: "trigger",
          label: "Run now",
          onAction: () => void handleTrigger(),
          disabled: isTriggering,
        };

  const actions: DetailAction[] = [
    ...(stateInfo.isPaused
      ? [
          {
            id: "resume",
            label: "Resume schedule",
            onAction: () => void handleResume(),
            disabled: isResuming,
            group: "state",
          },
        ]
      : []),
    {
      id: "toggle-enabled",
      label: spec?.enabled ? "Disable schedule" : "Enable schedule",
      onAction: () => void handleToggleEnabled(),
      disabled: isToggling,
      group: "state",
    },
    {
      id: "copy-id",
      label: "Copy ID",
      onAction: () => void copyId(scheduleId),
      group: "clipboard",
    },
    {
      id: "copy-slug",
      label: "Copy slug",
      onAction: () => void copyQualifiedSlug(org, slug),
      group: "clipboard",
    },
    {
      id: "edit-yaml",
      label: "Edit YAML",
      onAction: () => setEditOpen(true),
      group: "edit",
    },
    {
      id: "copy-yaml",
      label: "Copy YAML",
      onAction: () => void copyYaml(),
      group: "export",
    },
    {
      id: "download-yaml",
      label: "Download YAML",
      onAction: downloadYaml,
      group: "export",
    },
    {
      id: "delete",
      label: "Delete",
      variant: "destructive",
      onAction: () => void handleDelete(),
      disabled: isDeleting,
      group: "danger",
    },
  ];

  const headerMeta: ResourceHeaderMeta = {
    name: meta?.name || meta?.slug || "Untitled",
    id: scheduleId,
    org: meta?.org,
    slug: meta?.slug,
    icon: <ScheduleIcon className="stg:size-6 stg:text-muted-foreground" />,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
    status: stateInfo.phase,
    statusLabel: stateInfo.label,
  };

  const headerBanner =
    stateInfo.state === "disabled" ? (
      <StateBanner
        title="Schedule is disabled"
        onAction={() => void handleToggleEnabled()}
        actionLabel="Enable schedule"
        actionBusy={isToggling}
      >
        This schedule is staged disabled (
        <code className="stg:font-mono">spec.enabled</code> is off) — it will not
        fire on its cron cadence. Use{" "}
        <span className="stg:font-medium stg:text-foreground">Enable &amp; run now</span>{" "}
        to enable it and start one test run, or Enable it here to hand it to
        the cadence.
        {stateInfo.isPaused && (
          <>
            {" "}
            It is also paused by the platform ({status?.pausedReason}); after
            enabling, use Resume to clear the pause.
          </>
        )}
      </StateBanner>
    ) : stateInfo.state === "paused" ? (
      <StateBanner
        title="Paused by the platform"
        onAction={() => void handleResume()}
        actionLabel="Resume schedule"
        actionBusy={isResuming}
      >
        {status?.pausedReason} — resuming clears the pause and the failure
        streak. Re-applying the manifest does not.
      </StateBanner>
    ) : undefined;

  const overviewContent = (
    <div className="stg:flex stg:flex-col stg:gap-6">
      <Section title="Definition">
        <dl className="stg:divide-y stg:divide-border">
          <DetailRow label="Cadence">
            {editable ? (
              <CadenceInlineEditor
                cron={spec?.cron ?? ""}
                timeZone={spec?.timeZone ?? ""}
                onSave={(cron, timeZone) =>
                  saveSpecField("cadence", (s) => {
                    s.cron = cron;
                    s.timeZone = timeZone;
                  })
                }
                isSaving={isUpdating}
                error={
                  saveError?.field === "cadence" ? saveError.message : undefined
                }
              />
            ) : (
              <CadenceSummary
                cron={spec?.cron ?? ""}
                timeZone={spec?.timeZone ?? ""}
              />
            )}
          </DetailRow>
          {/* Target agent and target type are server-immutable on update,
              so this row never gains an edit affordance — error
              prevention over error handling. */}
          <DetailRow label="Target agent">
            {target?.agentRef ? (
              <ReferenceLink
                label={`${target.agentRef.org}/${target.agentRef.slug}`}
                onNavigate={
                  onNavigateToAgent
                    ? () =>
                        onNavigateToAgent(
                          target.agentRef!.org,
                          target.agentRef!.slug,
                        )
                    : undefined
                }
              />
            ) : (
              <span className="stg:text-sm stg:text-muted-foreground">—</span>
            )}
          </DetailRow>
          <DetailRow label="Message">
            {editable && target ? (
              <InlineEditTextarea
                value={target.message ?? ""}
                placeholder="The instruction the agent receives on every fire — write it for a run with no human present."
                onSave={(v) =>
                  saveSpecField("message", (s) => {
                    if (s.target.case === "agent") {
                      s.target.value.message = v.trim();
                    }
                  })
                }
                isSaving={isUpdating}
                error={
                  saveError?.field === "message" ? saveError.message : undefined
                }
                validate={validateMessage}
              />
            ) : (
              <p className="stg:whitespace-pre-wrap stg:break-words stg:text-sm stg:text-foreground">
                {target?.message || "—"}
              </p>
            )}
          </DetailRow>
          <DetailRow label="Environments">
            {editable && target ? (
              <EnvironmentsInlineEditor
                org={scheduleOrg}
                refs={target.environmentRefs ?? []}
                onSave={(refs) =>
                  saveSpecField("environments", (s) => {
                    if (s.target.case === "agent") {
                      s.target.value.environmentRefs = refs.map((r) =>
                        create(ApiResourceReferenceSchema, {
                          org: r.org,
                          slug: r.slug,
                          kind: ApiResourceKind.environment,
                        }),
                      );
                    }
                  })
                }
                isSaving={isUpdating}
                error={
                  saveError?.field === "environments"
                    ? saveError.message
                    : undefined
                }
              />
            ) : (
              <EnvironmentRefList
                refs={target?.environmentRefs ?? []}
              />
            )}
          </DetailRow>
          {/* Workspace is authored in the creation form (or YAML); an
              inline workspace editor is deliberately deferred — the
              read view keeps every stored entry visible. */}
          <DetailRow label="Workspace">
            <WorkspaceSummary
              entries={target?.workspaceEntries ?? []}
            />
          </DetailRow>
          <DetailRow label="Engine & model">
            {editable && target ? (
              <EngineModelInlineEditor
                invocation={target}
                onSave={(harness, modelName, serviceTier, thinkingMode) =>
                  saveSpecField("engine-model", (s) => {
                    if (s.target.case === "agent") {
                      applyEngineModel(s.target.value, harness, modelName, serviceTier, thinkingMode);
                    }
                  })
                }
                isSaving={isUpdating}
                error={
                  saveError?.field === "engine-model"
                    ? saveError.message
                    : undefined
                }
              />
            ) : (
              <EngineModelSummary invocation={target} />
            )}
          </DetailRow>
          <DetailRow label="Budget per run">
            {editable && target ? (
              <BudgetInlineEditor
                config={target.runConfig}
                onSave={(maxCostUsd) =>
                  saveSpecField("budget", (s) => {
                    if (s.target.case === "agent") {
                      applyBudget(s.target.value, maxCostUsd);
                    }
                  })
                }
                isSaving={isUpdating}
                error={
                  saveError?.field === "budget" ? saveError.message : undefined
                }
              />
            ) : (
              <BudgetSummary config={target?.runConfig} />
            )}
          </DetailRow>
        </dl>
      </Section>

      <Section title="Status">
        <dl className="stg:divide-y stg:divide-border">
          <DetailRow label="Next fire">
            <span className="stg:text-sm stg:text-foreground">
              {stateInfo.state === "active" && status?.nextFireAt
                ? formatNextFire(timestampDate(status.nextFireAt), renderNow)
                : "—"}
            </span>
          </DetailRow>
          <DetailRow label="Last fired">
            <span className="stg:text-sm stg:text-foreground">
              {status?.lastFireAt
                ? formatRelativeTime(
                    timestampDate(status.lastFireAt),
                    renderNow,
                  )
                : "Never"}
            </span>
          </DetailRow>
          <DetailRow label="Last execution">
            {status?.lastExecutionId ? (
              <ReferenceLink
                label={status.lastExecutionId}
                mono
                onNavigate={
                  onNavigateToExecution
                    ? () => onNavigateToExecution(status.lastExecutionId)
                    : undefined
                }
              />
            ) : (
              <span className="stg:text-sm stg:text-muted-foreground">—</span>
            )}
          </DetailRow>
          <DetailRow label="Failure streak">
            <FailureStreak count={status?.consecutiveFailures ?? 0} />
          </DetailRow>
        </dl>
      </Section>

      <Section
        title="Recent runs"
        headerActions={
          totalRunCount > recentRuns.length ? (
            <button
              type="button"
              onClick={() => effectiveOnTabChange(RUNS_TAB_ID)}
              className={cn(
                "stg:text-xs stg:font-medium stg:text-primary stg:underline-offset-2 stg:hover:underline",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded-sm",
              )}
            >
              View all {totalRunCount} runs
            </button>
          ) : undefined
        }
      >
        <ScheduleRunsCompactList
          runs={recentRuns}
          isLoading={recentRunsLoading}
          now={renderNow}
          onNavigateToExecution={onNavigateToExecution}
        />
      </Section>
    </div>
  );

  let tabContent: React.ReactNode;
  if (activeAdditionalTab) {
    tabContent = activeAdditionalTab.content;
  } else if (effectiveActiveTab === RUNS_TAB_ID) {
    tabContent = (
      <ScheduleRunsTable
        key={runsVersion}
        scheduleId={scheduleId}
        now={now}
        onNavigateToExecution={onNavigateToExecution}
      />
    );
  } else {
    tabContent = overviewContent;
  }

  return (
    <>
      <ResourceDetailShell
        header={headerMeta}
        headerBanner={headerBanner}
        primaryAction={primaryAction}
        actions={actions}
        tabs={effectiveTabs}
        activeTab={effectiveTabs ? effectiveActiveTab : undefined}
        onTabChange={effectiveTabs ? effectiveOnTabChange : undefined}
        tabsAriaLabel="Schedule detail sections"
        className={className}
      >
        {tabContent}
      </ResourceDetailShell>

      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      {/* Mounted on demand: the editor serializes the resource and pulls
          the CodeMirror chunk, neither of which should cost anything
          until the action is actually invoked (DD-013). The dialog
          resets its edit state on open, so unmount-on-close loses
          nothing. */}
      {editOpen && (
        <EditResourceYamlDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          resource={schedule}
          onApplied={() => refetch()}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// State banner — one lever, one remedy, inline
// ---------------------------------------------------------------------------

function StateBanner({
  title,
  children,
  actionLabel,
  onAction,
  actionBusy,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
  readonly actionLabel: string;
  readonly onAction: () => void;
  readonly actionBusy: boolean;
}) {
  return (
    <div
      role="status"
      className="stg:flex stg:items-start stg:gap-2.5 stg:rounded-lg stg:border stg:border-warning/30 stg:bg-warning/5 stg:px-4 stg:py-3"
    >
      <WarningIcon className="stg:mt-0.5 stg:size-4 stg:shrink-0 stg:text-warning" />
      <div className="stg:min-w-0 stg:flex-1">
        <p className="stg:text-sm stg:font-medium stg:text-foreground">{title}</p>
        <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">{children}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        disabled={actionBusy}
        className={cn(
          "stg:shrink-0 stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-foreground",
          "stg:hover:bg-accent stg:hover:text-accent-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        )}
      >
        {actionLabel}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cadence summary — plain English first, raw cron as the precise record
// ---------------------------------------------------------------------------

/**
 * Render a schedule's cadence for reading: the plain-English sentence
 * first ("Every day at 09:00 (Asia/Kolkata)"), the raw cron beneath it
 * in muted mono as the precise record.
 *
 * `cronToCadence` RECOGNIZES rather than parses (the platform owns no
 * cron parser in either edition — see cadence.ts): expressions outside
 * the builder's shapes come back as `custom`, for which the raw cron IS
 * the primary display, with the time zone alongside so nothing the
 * spec stores is hidden.
 */
function CadenceSummary({
  cron,
  timeZone,
}: {
  readonly cron: string;
  readonly timeZone: string;
}) {
  if (!cron) return <span className="stg:text-sm stg:text-muted-foreground">—</span>;

  const preset = cronToCadence(cron);
  if (preset.kind === "custom") {
    return (
      <div className="stg:flex stg:flex-col stg:gap-0.5">
        <code className="stg:font-mono stg:text-sm stg:text-foreground">{cron}</code>
        {timeZone && (
          <span className="stg:text-xs stg:text-muted-foreground">{timeZone}</span>
        )}
      </div>
    );
  }
  return (
    <div className="stg:flex stg:flex-col stg:gap-0.5">
      <span className="stg:text-sm stg:text-foreground">
        {describeCadence(preset, timeZone || undefined)}
      </span>
      <code className="stg:font-mono stg:text-xs stg:text-muted-foreground">{cron}</code>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline editors — per-field click-to-edit over the lossless write path
// ---------------------------------------------------------------------------
//
// Each editor follows the InlineEdit* family's contract: read mode is a
// click target with a hover pencil; edit mode holds a local draft with
// explicit Save/Cancel; a failed save keeps the editor open with the
// server's message rendered verbatim beneath it (DD-006). The editors
// stay in this file (the AgentDetailView single-organism precedent) and
// reuse the creation form's field components — CadenceField,
// TimeZoneField, EnvironmentPicker — so creating and editing a schedule
// are the same experience.

/** Cadence + time zone edit in one panel — they form one sentence. */
function CadenceInlineEditor({
  cron,
  timeZone,
  onSave,
  isSaving,
  error,
}: {
  readonly cron: string;
  readonly timeZone: string;
  readonly onSave: (cron: string, timeZone: string) => Promise<boolean>;
  readonly isSaving: boolean;
  readonly error?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftCadence, setDraftCadence] = useState<CadencePreset>(() =>
    cronToCadence(cron),
  );
  const [draftZone, setDraftZone] = useState(timeZone);

  const startEdit = () => {
    // cronToCadence round-trips the stored cron into the preset picker;
    // unrecognized shapes land on the Custom escape hatch with the raw
    // string intact.
    setDraftCadence(cronToCadence(cron));
    setDraftZone(timeZone || browserTimeZone());
    setIsEditing(true);
  };

  if (!isEditing) {
    return (
      <InlineReadButton onEdit={startEdit} ariaLabel="Edit cadence">
        <CadenceSummary cron={cron} timeZone={timeZone} />
      </InlineReadButton>
    );
  }

  const draftCron = cadenceToCron(draftCadence).trim();
  const canSave = draftCron !== "" && validateCron(draftCron) === null;

  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      <CadenceField
        value={draftCadence}
        onChange={setDraftCadence}
        timeZone={draftZone}
        disabled={isSaving}
      />
      <div className="stg:space-y-1">
        <span className={editorLabelClasses}>Time zone</span>
        <TimeZoneField
          value={draftZone}
          onChange={setDraftZone}
          disabled={isSaving}
        />
      </div>
      <InlineEditActions
        onCancel={() => setIsEditing(false)}
        onSave={async () => {
          const ok = await onSave(draftCron, draftZone);
          if (ok) setIsEditing(false);
        }}
        isSaving={isSaving}
        canSave={canSave}
        error={error}
      />
    </div>
  );
}

/** Environment bindings edit — org-shared credentials only (DD-017 D-2). */
function EnvironmentsInlineEditor({
  org,
  refs,
  onSave,
  isSaving,
  error,
}: {
  readonly org: string;
  readonly refs: readonly { org: string; slug: string }[];
  readonly onSave: (refs: readonly ResourceRef[]) => Promise<boolean>;
  readonly isSaving: boolean;
  readonly error?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<ResourceRef[]>([]);

  const startEdit = () => {
    setDraft(refs.map((r) => ({ org: r.org, slug: r.slug })));
    setIsEditing(true);
  };

  if (!isEditing) {
    return (
      <InlineReadButton onEdit={startEdit} ariaLabel="Edit environments">
        <EnvironmentRefList refs={refs} />
      </InlineReadButton>
    );
  }

  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      <EnvironmentPicker
        org={org}
        value={draft}
        onChange={setDraft}
        disabled={isSaving}
        // Only org-shared environments resolve for a schedule fire (the
        // same credential surface a channel binding uses), so offering
        // anything else could only produce refused runs.
        filterEnvironment={isOrgSharedEnvironment}
      />
      <p className="stg:text-[0.65rem] stg:text-muted-foreground">
        Bind org-shared credentials so the agent&rsquo;s tools work on an
        unattended fire. Without this, an agent whose tools need credentials
        will be refused every run.
      </p>
      <InlineEditActions
        onCancel={() => setIsEditing(false)}
        onSave={async () => {
          const ok = await onSave(draft);
          if (ok) setIsEditing(false);
        }}
        isSaving={isSaving}
        canSave
        error={error}
      />
    </div>
  );
}

function isOrgSharedEnvironment(env: Environment): boolean {
  return env.metadata?.visibility === ApiResourceVisibility.visibility_org;
}

/**
 * Engine & model edit — the composer's own picker, with the creation
 * form's atomic semantics (DD-018 D-5): picking a model pins BOTH the
 * harness and the model (the registry scopes models per harness);
 * clearing the model unpins both, and the platform defaults apply.
 */
function EngineModelInlineEditor({
  invocation,
  onSave,
  isSaving,
  error,
}: {
  readonly invocation: AgentInvocation;
  readonly onSave: (
    harness: Harness,
    modelName: string,
    serviceTier: ServiceTierOption,
    thinkingMode: ThinkingModeOption,
  ) => Promise<boolean>;
  readonly isSaving: boolean;
  readonly error?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [modelName, setModelName] = useState("");
  const [harness, setHarness] = useState<HarnessOption>("cursor");
  const [serviceTier, setServiceTier] = useState<ServiceTierOption>("standard");
  const [thinkingMode, setThinkingMode] = useState<ThinkingModeOption>("disabled");

  const startEdit = () => {
    setModelName(invocation.runConfig?.modelName ?? "");
    setHarness(
      invocation.harness !== Harness.UNSPECIFIED
        ? fromProtoHarness(invocation.harness)
        : "cursor",
    );
    setServiceTier(
      fromProtoServiceTier(invocation.runConfig?.serviceTier) ?? "standard",
    );
    setThinkingMode(
      fromProtoThinkingMode(invocation.runConfig?.thinkingMode) ?? "disabled",
    );
    setIsEditing(true);
  };

  if (!isEditing) {
    return (
      <InlineReadButton onEdit={startEdit} ariaLabel="Edit engine and model">
        <EngineModelSummary invocation={invocation} />
      </InlineReadButton>
    );
  }

  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
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
          disabled={isSaving}
        />
        {modelName !== "" && (
          <button
            type="button"
            onClick={() => {
              setModelName("");
              setServiceTier("standard");
              setThinkingMode("disabled");
            }}
            disabled={isSaving}
            className="stg:rounded-md stg:px-2 stg:py-1 stg:text-[0.65rem] stg:text-muted-foreground stg:hover:text-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:disabled:pointer-events-none stg:disabled:opacity-50"
          >
            Reset to platform default
          </button>
        )}
      </div>
      <p className="stg:text-[0.65rem] stg:text-muted-foreground">
        Runs use the platform&rsquo;s default engine and model unless you pick
        one here. Picking a model pins the engine it belongs to.
      </p>
      <InlineEditActions
        onCancel={() => setIsEditing(false)}
        onSave={async () => {
          const ok = await onSave(
            modelName !== "" ? toProtoHarness(harness) : Harness.UNSPECIFIED,
            modelName,
            serviceTier,
            thinkingMode,
          );
          if (ok) setIsEditing(false);
        }}
        isSaving={isSaving}
        canSave
        error={error}
      />
    </div>
  );
}

/** Budget edit — blank inherits the platform default (DD-018 D-2). */
function BudgetInlineEditor({
  config,
  onSave,
  isSaving,
  error,
}: {
  readonly config: RunConfig | undefined;
  readonly onSave: (maxCostUsd: number | undefined) => Promise<boolean>;
  readonly isSaving: boolean;
  readonly error?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [budgetUsd, setBudgetUsd] = useState("");

  const startEdit = () => {
    setBudgetUsd(config && config.maxCostUsd > 0 ? String(config.maxCostUsd) : "");
    setIsEditing(true);
  };

  if (!isEditing) {
    return (
      <InlineReadButton onEdit={startEdit} ariaLabel="Edit budget">
        <BudgetSummary config={config} />
      </InlineReadButton>
    );
  }

  const cost = Number.parseFloat(budgetUsd);
  const parsedBudget = Number.isFinite(cost) && cost > 0 ? cost : undefined;

  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      <input
        type="number"
        min="0"
        step="any"
        aria-label="Budget per run (USD)"
        value={budgetUsd}
        onChange={(e) => setBudgetUsd(e.target.value)}
        placeholder="platform default"
        disabled={isSaving}
        className={cn(editorInputClasses, "stg:sm:max-w-48")}
      />
      <p className="stg:text-[0.65rem] stg:text-muted-foreground">
        Each run stops when it reaches this spend. You can lower the
        platform&rsquo;s per-run cap, never raise it past the
        platform&rsquo;s ceiling. Blank inherits the platform default.
      </p>
      <InlineEditActions
        onCancel={() => setIsEditing(false)}
        onSave={async () => {
          const ok = await onSave(parsedBudget);
          if (ok) setIsEditing(false);
        }}
        isSaving={isSaving}
        canSave
        error={error}
      />
    </div>
  );
}

/**
 * Write the engine+model choice onto the invocation, preserving the
 * run-config fields the editor does not own (budget; the API-only tool
 * rounds), and dropping an all-empty run_config — the proto's "empty =
 * inherit" contract (DD-017 D-3 as carried into DD-018 D-2).
 */
function applyEngineModel(
  invocation: AgentInvocation,
  harness: Harness,
  modelName: string,
  serviceTier: ServiceTierOption,
  thinkingMode: ThinkingModeOption,
): void {
  invocation.harness = harness;
  invocation.runConfig = normalizeRunConfig(
    modelName,
    invocation.runConfig?.maxCostUsd ?? 0,
    invocation.runConfig?.maxToolRounds ?? 0,
    // The variant attributes ride the model choice: no model, no tier and
    // no thinking (#357/#772).
    modelName.trim() !== "" ? serviceTier : "standard",
    modelName.trim() !== "" ? thinkingMode : "disabled",
  );
}

/** Budget twin of {@link applyEngineModel} — writes only the cost cap. */
function applyBudget(
  invocation: AgentInvocation,
  maxCostUsd: number | undefined,
): void {
  invocation.runConfig = normalizeRunConfig(
    invocation.runConfig?.modelName ?? "",
    maxCostUsd ?? 0,
    invocation.runConfig?.maxToolRounds ?? 0,
    fromProtoServiceTier(invocation.runConfig?.serviceTier) ?? "standard",
    fromProtoThinkingMode(invocation.runConfig?.thinkingMode) ?? "disabled",
  );
}

function normalizeRunConfig(
  modelName: string,
  maxCostUsd: number,
  maxToolRounds: number,
  serviceTier: ServiceTierOption,
  thinkingMode: ThinkingModeOption,
): RunConfig | undefined {
  const fields: {
    modelName?: string;
    maxCostUsd?: number;
    maxToolRounds?: number;
    serviceTier?: ServiceTier;
    thinkingMode?: ThinkingMode;
  } = {};
  if (modelName.trim() !== "") fields.modelName = modelName.trim();
  if (maxCostUsd > 0) fields.maxCostUsd = maxCostUsd;
  if (maxToolRounds > 0) fields.maxToolRounds = maxToolRounds;
  // Only an active fast choice is carried — an untouched tier stays
  // absent, preserving the unspecified-vs-explicit ledger distinction (#357).
  if (serviceTier === "fast") fields.serviceTier = toProtoServiceTier(serviceTier);
  // The tier's #772 twin: only an active enabled choice is carried.
  if (thinkingMode === "enabled") fields.thinkingMode = toProtoThinkingMode(thinkingMode);

  return Object.keys(fields).length > 0
    ? create(RunConfigSchema, fields)
    : undefined;
}

/** Mirrors the server's constraint so the editor rejects bad input instantly. */
function validateMessage(value: string): string | null {
  if (!value.trim()) {
    return "Message is required — the agent receives it on every fire.";
  }
  if (value.length > MESSAGE_MAX_LEN) {
    return `Message must be at most ${MESSAGE_MAX_LEN} characters.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inline-edit chrome shared by the bespoke editors above
// ---------------------------------------------------------------------------

const editorLabelClasses = "stg:block stg:text-xs stg:font-medium stg:text-foreground";

const editorInputClasses = cn(
  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);

/** Read-mode click target with the family's hover pencil. */
function InlineReadButton({
  onEdit,
  ariaLabel,
  children,
}: {
  readonly onEdit: () => void;
  readonly ariaLabel: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="stg:group/inline-edit">
      <button
        type="button"
        onClick={onEdit}
        aria-label={ariaLabel}
        className={cn(
          "stg:-mx-2 stg:w-full stg:rounded-md stg:px-2 stg:py-1.5 stg:text-left stg:transition-colors",
          "stg:hover:bg-accent-hover stg:cursor-pointer",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
        )}
      >
        <div className="stg:flex stg:items-start stg:justify-between stg:gap-2">
          <div className="stg:min-w-0 stg:flex-1">{children}</div>
          <PencilIcon className="stg:mt-0.5 stg:size-3 stg:shrink-0 stg:text-muted-foreground stg:opacity-0 stg:transition-opacity stg:group-hover/inline-edit:opacity-100" />
        </div>
      </button>
    </div>
  );
}

/** Save/Cancel footer with the field-attributed error line. */
function InlineEditActions({
  onCancel,
  onSave,
  isSaving,
  canSave,
  error,
}: {
  readonly onCancel: () => void;
  readonly onSave: () => void;
  readonly isSaving: boolean;
  readonly canSave: boolean;
  readonly error?: string;
}) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-1.5">
      <div className="stg:flex stg:items-center stg:justify-end stg:gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className={cn(
            "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
            "stg:border stg:border-border stg:bg-background stg:text-foreground stg:hover:bg-accent stg:hover:text-accent-foreground",
            "stg:disabled:opacity-50",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave || isSaving}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        >
          {isSaving && <SpinnerIcon size={14} />}
          Save
        </button>
      </div>
      {error && (
        <p className="stg:text-xs stg:text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail rows and references
// ---------------------------------------------------------------------------

function DetailRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="stg:flex stg:items-start stg:gap-4 stg:px-4 stg:py-2.5">
      <dt className="stg:w-40 stg:shrink-0 stg:pt-0.5 stg:text-xs stg:font-medium stg:text-muted-foreground">
        {label}
      </dt>
      <dd className="stg:min-w-0 stg:flex-1">{children}</dd>
    </div>
  );
}

/** The bound environment references, or the em-dash when there are none. */
function EnvironmentRefList({
  refs,
}: {
  readonly refs: readonly { org: string; slug: string }[];
}) {
  if (refs.length === 0) {
    return <span className="stg:text-sm stg:text-muted-foreground">—</span>;
  }
  return (
    <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-0.5")}>
      {refs.map((ref, i) => (
        <li
          key={`${ref.org}/${ref.slug}-${i}`}
          className="stg:font-mono stg:text-xs stg:text-foreground"
        >
          {ref.org ? `${ref.org}/${ref.slug}` : ref.slug}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Failure streak — status.consecutive_failures, explained
// ---------------------------------------------------------------------------

/**
 * The platform's failure streak: how many SCHEDULED runs in a row ended
 * badly. The server increments it per failed cron fire, resets it on a
 * successful run (or Resume), and auto-pauses the schedule when the
 * streak crosses its threshold. Manual "Run now" fires never count.
 *
 * The threshold itself is server configuration not exposed through the
 * API, so the copy stays qualitative — a hardcoded "of 5" here could
 * silently drift from what the platform actually enforces.
 */
function FailureStreak({ count }: { readonly count: number }) {
  if (count === 0) {
    return <span className="stg:text-sm stg:text-foreground">0</span>;
  }
  return (
    <div className="stg:flex stg:flex-col stg:gap-0.5">
      <span className="stg:text-sm stg:font-medium stg:text-warning">
        {count} consecutive failed {count === 1 ? "run" : "runs"}
      </span>
      <p className="stg:text-xs stg:text-muted-foreground">
        Failed scheduled runs raise this streak; too many in a row and the
        platform pauses the schedule automatically. One successful run
        resets it to 0. Manual runs never count.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The invocation's run shape — engine+model, budget, workspace summaries
// ---------------------------------------------------------------------------

/** "Cursor · composer-2.5", either half falling back to the platform default. */
function EngineModelSummary({
  invocation,
}: {
  readonly invocation: AgentInvocation | undefined;
}) {
  const harness = invocation?.harness ?? Harness.UNSPECIFIED;
  const modelName = invocation?.runConfig?.modelName ?? "";

  if (harness === Harness.UNSPECIFIED && modelName === "") {
    return (
      <span className="stg:text-sm stg:text-muted-foreground">Platform default</span>
    );
  }

  const parts: string[] = [];
  if (harness !== Harness.UNSPECIFIED) {
    parts.push(HARNESS_META[fromProtoHarness(harness)].label);
  }
  parts.push(modelName !== "" ? modelName : "platform-default model");
  if (invocation?.runConfig?.serviceTier === ServiceTier.FAST) {
    parts.push("Fast tier");
  }
  if (invocation?.runConfig?.thinkingMode === ThinkingMode.ENABLED) {
    parts.push("Thinking");
  }
  return <span className="stg:text-sm stg:text-foreground">{parts.join(" · ")}</span>;
}

/** The per-run cost cap, plus the API-only tool-round bound when set. */
function BudgetSummary({
  config,
}: {
  readonly config: RunConfig | undefined;
}) {
  const maxCostUsd = config?.maxCostUsd ?? 0;
  const maxToolRounds = config?.maxToolRounds ?? 0;

  return (
    <div className="stg:flex stg:flex-col stg:gap-0.5">
      {maxCostUsd > 0 ? (
        <span className="stg:text-sm stg:text-foreground">
          ≤ ${maxCostUsd.toFixed(2)} per run
        </span>
      ) : (
        <span className="stg:text-sm stg:text-muted-foreground">Platform default</span>
      )}
      {/* Reachable through the API only (DD-018 D-5) — rendered when
          set so nothing the spec stores is hidden. */}
      {maxToolRounds > 0 && (
        <span className="stg:text-xs stg:text-muted-foreground">
          ≤ {maxToolRounds} tool rounds
        </span>
      )}
    </div>
  );
}

/** The git workspace each fire clones, or the em-dash when none. */
function WorkspaceSummary({
  entries,
}: {
  readonly entries: readonly WorkspaceEntry[];
}) {
  if (entries.length === 0) {
    return <span className="stg:text-sm stg:text-muted-foreground">—</span>;
  }
  return (
    <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-0.5")}>
      {entries.map((entry, i) => {
        const git =
          entry.source?.source?.case === "gitRepo"
            ? entry.source.source.value
            : undefined;
        return (
          <li key={`${entry.name}-${i}`} className="stg:text-xs stg:text-foreground">
            <span className="stg:font-medium">{entry.name}</span>
            {git?.url && (
              <span className="stg:ml-1.5 stg:font-mono stg:text-muted-foreground">
                {git.url}
                {git.branch ? `@${git.branch}` : ""}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ReferenceLink({
  label,
  onNavigate,
  mono,
}: {
  readonly label: string;
  readonly onNavigate?: () => void;
  readonly mono?: boolean;
}) {
  const textClass = cn("stg:text-sm", mono && "stg:font-mono stg:text-xs");
  if (!onNavigate) {
    return <span className={cn(textClass, "stg:text-foreground")}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={onNavigate}
      className={cn(
        textClass,
        "stg:text-primary stg:underline-offset-2 stg:hover:underline",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded-sm",
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Non-happy states
// ---------------------------------------------------------------------------

function LoadingSkeleton({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn("stg:flex stg:flex-col stg:gap-6", className)}
      aria-busy="true"
      aria-label="Loading schedule details"
    >
      <div className="stg:flex stg:items-start stg:gap-3">
        <div className="stg:mt-1 stg:size-6 stg:shrink-0 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:flex-1 stg:space-y-2">
          <div className="stg:h-5 stg:w-48 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-3 stg:w-64 stg:animate-pulse stg:rounded stg:bg-muted" />
        </div>
      </div>
      <div className="stg:space-y-2">
        <div className="stg:h-3 stg:w-28 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div
          className="stg:animate-pulse stg:rounded-lg stg:border stg:border-border stg:bg-muted-faint"
          style={{ height: "160px" }}
        />
      </div>
      <div className="stg:space-y-2">
        <div className="stg:h-3 stg:w-20 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div
          className="stg:animate-pulse stg:rounded-lg stg:border stg:border-border stg:bg-muted-faint"
          style={{ height: "160px" }}
        />
      </div>
    </div>
  );
}

function NotFoundState({ className }: { readonly className?: string }) {
  return (
    <div
      role="status"
      className={cn("stg:flex stg:flex-col stg:items-center stg:gap-2 stg:py-12 stg:text-center", className)}
    >
      <ScheduleIcon className="stg:size-10 stg:text-muted-foreground-faint" />
      <p className="stg:text-sm stg:font-medium stg:text-muted-foreground">
        Schedule not found
      </p>
      <p className="stg:text-xs stg:text-muted-foreground-subtle">
        This schedule doesn&apos;t exist or you don&apos;t have access to it.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline SVG — no icon-library dependency)
// ---------------------------------------------------------------------------

/** Clock-with-arrow icon shared by the schedule views. */
export function ScheduleIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v5h-5" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function WarningIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.5 15 14H1L8 1.5Z" />
      <path d="M8 6v4" />
      <path d="M8 12.2v.05" />
    </svg>
  );
}

function PencilIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 1.5a2.121 2.121 0 0 1 3 3L5 14l-4 1 1-4Z" />
    </svg>
  );
}

