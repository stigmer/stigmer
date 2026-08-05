"use client";

import { useEffect, useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { formatRelativeTime } from "../activity/format-relative-time.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EditResourceYamlDialog } from "../manifest/EditResourceYamlDialog.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell.js";
import { Section } from "../resource-detail/Section.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { useCopyResource } from "../resource-detail/useCopyResource.js";
import { useDeleteResource } from "../resource-detail/useDeleteResource.js";
import type { DetailAction, ResourceHeaderMeta } from "../resource-detail/types.js";
import { useExportResource } from "../library/useExportResource.js";
import {
  ScheduleRunOrigin,
  ScheduleRunOutcome,
  type ScheduleRun,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import type { ScheduleRunConfig } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/spec_pb";
import { deriveScheduleState, formatNextFire } from "./scheduleState.js";
import { useSchedule } from "./useSchedule.js";
import { useScheduleRuns } from "./useScheduleRuns.js";
import { useResumeSchedule } from "./useResumeSchedule.js";
import { useSetScheduleEnabled } from "./useSetScheduleEnabled.js";
import { useTriggerSchedule } from "./useTriggerSchedule.js";

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
   * Called when the user activates the last-execution reference
   * (`aex_…`). When omitted, the id renders as plain text.
   */
  readonly onNavigateToExecution?: (executionId: string) => void;
  /** Called after a successful delete (navigate back to the list). */
  readonly onDeleted?: () => void;
  /** Called when the schedule loads or reloads (e.g. breadcrumb label sync). */
  readonly onResourceLoad?: (schedule: Schedule) => void;
  /**
   * The instant "next fire" countdowns are computed against.
   * Injectable for deterministic tests and Scenar fixtures.
   * @default new Date() at render
   */
  readonly now?: Date;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Self-contained detail view for a Schedule (stigmer/stigmer#352).
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
 * (the banner names the remedy). Edit YAML, Export, and Delete round
 * out the action set.
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
  now,
  className,
}: ScheduleDetailViewProps) {
  const { schedule, isLoading, error, refetch } = useSchedule(org, slug);
  const {
    runs,
    isLoading: runsLoading,
    refetch: refetchRuns,
  } = useScheduleRuns(schedule?.metadata?.id ?? null);

  const { resumeSchedule, isResuming } = useResumeSchedule();
  const { triggerSchedule, isTriggering } = useTriggerSchedule();
  const { setEnabled, isPending: isToggling } = useSetScheduleEnabled();
  const { deleteResource, isDeleting } = useDeleteResource(
    "schedule",
    schedule?.metadata?.id ?? null,
    schedule?.metadata?.name,
  );
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const [editOpen, setEditOpen] = useState(false);

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
    refetchRuns();
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
    icon: <ScheduleIcon className="size-6 text-muted-foreground" />,
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
        <code className="font-mono">spec.enabled</code> is off) — it will not
        fire on its cron cadence. Use{" "}
        <span className="font-medium text-foreground">Enable &amp; run now</span>{" "}
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

  return (
    <>
      <ResourceDetailShell
        header={headerMeta}
        headerBanner={headerBanner}
        primaryAction={primaryAction}
        actions={actions}
        className={className}
      >
        <div className="flex flex-col gap-6">
          <Section title="Definition">
            <dl className="divide-y divide-border">
              <DetailRow label="Cron">
                <code className="font-mono text-sm text-foreground">
                  {spec?.cron || "—"}
                </code>
              </DetailRow>
              <DetailRow label="Time zone">
                <span className="text-sm text-foreground">
                  {spec?.timeZone || "—"}
                </span>
              </DetailRow>
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
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </DetailRow>
              <DetailRow label="Message">
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                  {target?.message || "—"}
                </p>
              </DetailRow>
              <DetailRow label="Environments">
                {target?.environmentRefs && target.environmentRefs.length > 0 ? (
                  <ul className="flex flex-col gap-0.5">
                    {target.environmentRefs.map((ref, i) => (
                      <li
                        key={`${ref.org}/${ref.slug}-${i}`}
                        className="font-mono text-xs text-foreground"
                      >
                        {ref.org ? `${ref.org}/${ref.slug}` : ref.slug}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </DetailRow>
              <DetailRow label="Run limits">
                <RunLimits config={target?.runConfig} />
              </DetailRow>
            </dl>
          </Section>

          <Section title="Status">
            <dl className="divide-y divide-border">
              <DetailRow label="Next fire">
                <span className="text-sm text-foreground">
                  {stateInfo.state === "active" && status?.nextFireAt
                    ? formatNextFire(timestampDate(status.nextFireAt), renderNow)
                    : "—"}
                </span>
              </DetailRow>
              <DetailRow label="Last fired">
                <span className="text-sm text-foreground">
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
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </DetailRow>
              <DetailRow label="Consecutive failures">
                <span
                  className={cn(
                    "text-sm",
                    (status?.consecutiveFailures ?? 0) > 0
                      ? "font-medium text-warning"
                      : "text-foreground",
                  )}
                >
                  {status?.consecutiveFailures ?? 0}
                </span>
              </DetailRow>
            </dl>
          </Section>

          <Section title="Runs">
            <RunHistory
              runs={runs}
              isLoading={runsLoading}
              now={renderNow}
              onNavigateToExecution={onNavigateToExecution}
            />
          </Section>
        </div>
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
      className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3"
    >
      <WarningIcon className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{children}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        disabled={actionBusy}
        className={cn(
          "shrink-0 rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium text-foreground",
          "hover:bg-accent hover:text-accent-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
        )}
      >
        {actionLabel}
      </button>
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
    <div className="flex items-start gap-4 px-4 py-2.5">
      <dt className="w-40 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Run limits — the per-schedule run_config, or the platform-default note
// ---------------------------------------------------------------------------

function RunLimits({
  config,
}: {
  readonly config: ScheduleRunConfig | undefined;
}) {
  const modelName = config?.modelName ?? "";
  const maxCostUsd = config?.maxCostUsd ?? 0;
  const maxToolRounds = config?.maxToolRounds ?? 0;
  const parts: string[] = [];
  if (modelName) parts.push(modelName);
  if (maxCostUsd > 0) parts.push(`≤ $${maxCostUsd.toFixed(2)}/run`);
  if (maxToolRounds > 0) parts.push(`≤ ${maxToolRounds} tool rounds`);

  if (parts.length === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        Platform defaults
      </span>
    );
  }
  return <span className="text-sm text-foreground">{parts.join(" · ")}</span>;
}

// ---------------------------------------------------------------------------
// Run history — the fire ledger, rendered (DD-017 D-7)
// ---------------------------------------------------------------------------

function RunHistory({
  runs,
  isLoading,
  now,
  onNavigateToExecution,
}: {
  readonly runs: readonly ScheduleRun[];
  readonly isLoading: boolean;
  readonly now: Date;
  readonly onNavigateToExecution?: (executionId: string) => void;
}) {
  if (isLoading && runs.length === 0) {
    return (
      <div className="space-y-2 px-4 py-3" aria-busy="true">
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
      </div>
    );
  }
  if (runs.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-muted-foreground">
        No runs yet. Use &ldquo;Run now&rdquo; to fire a test run — every fire,
        including a refused one, is recorded here.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {runs.map((run, i) => (
        <RunRow
          key={`${run.executionId || "no-exec"}-${run.origin}-${i}`}
          run={run}
          now={now}
          onNavigateToExecution={onNavigateToExecution}
        />
      ))}
    </ul>
  );
}

function RunRow({
  run,
  now,
  onNavigateToExecution,
}: {
  readonly run: ScheduleRun;
  readonly now: Date;
  readonly onNavigateToExecution?: (executionId: string) => void;
}) {
  const when = run.nominalFireTime
    ? formatRelativeTime(timestampDate(run.nominalFireTime), now)
    : "—";
  const badge = outcomeBadge(run.outcome);
  const originLabel =
    run.origin === ScheduleRunOrigin.MANUAL ? "Manual" : "Scheduled";

  return (
    <li className="flex flex-col gap-1 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </span>
        <span className="text-xs text-muted-foreground">{originLabel}</span>
        <span className="text-xs text-muted-foreground-subtle">·</span>
        <span className="text-xs text-muted-foreground">{when}</span>
      </div>
      {run.reason && (
        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {run.reason}
        </p>
      )}
      {run.executionId &&
        (onNavigateToExecution ? (
          <button
            type="button"
            onClick={() => onNavigateToExecution(run.executionId)}
            className={cn(
              "self-start font-mono text-[0.65rem] text-primary underline-offset-2 hover:underline",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
            )}
          >
            {run.executionId}
          </button>
        ) : (
          <span className="self-start font-mono text-[0.65rem] text-muted-foreground">
            {run.executionId}
          </span>
        ))}
    </li>
  );
}

/** Verbatim-label badges for a run outcome, colored by health. */
function outcomeBadge(outcome: ScheduleRunOutcome): {
  label: string;
  className: string;
} {
  switch (outcome) {
    case ScheduleRunOutcome.STARTED:
      return { label: "Started", className: "bg-info/10 text-info" };
    case ScheduleRunOutcome.COMPLETED:
      return { label: "Completed", className: "bg-success/10 text-success" };
    case ScheduleRunOutcome.REFUSED:
      return { label: "Refused", className: "bg-warning/10 text-warning" };
    case ScheduleRunOutcome.TARGET_MISSING:
      return { label: "Target missing", className: "bg-warning/10 text-warning" };
    case ScheduleRunOutcome.SKIPPED:
      return { label: "Skipped", className: "bg-muted text-muted-foreground" };
    case ScheduleRunOutcome.FAILED:
      return { label: "Failed", className: "bg-destructive/10 text-destructive" };
    case ScheduleRunOutcome.TIMED_OUT:
      return { label: "Timed out", className: "bg-destructive/10 text-destructive" };
    default:
      return { label: "Unknown", className: "bg-muted text-muted-foreground" };
  }
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
  const textClass = cn("text-sm", mono && "font-mono text-xs");
  if (!onNavigate) {
    return <span className={cn(textClass, "text-foreground")}>{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={onNavigate}
      className={cn(
        textClass,
        "text-primary underline-offset-2 hover:underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
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
      className={cn("flex flex-col gap-6", className)}
      aria-busy="true"
      aria-label="Loading schedule details"
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 size-6 shrink-0 animate-pulse rounded bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="h-3 w-64 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        <div
          className="animate-pulse rounded-lg border border-border bg-muted-faint"
          style={{ height: "160px" }}
        />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        <div
          className="animate-pulse rounded-lg border border-border bg-muted-faint"
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
      className={cn("flex flex-col items-center gap-2 py-12 text-center", className)}
    >
      <ScheduleIcon className="size-10 text-muted-foreground-faint" />
      <p className="text-sm font-medium text-muted-foreground">
        Schedule not found
      </p>
      <p className="text-xs text-muted-foreground-subtle">
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
