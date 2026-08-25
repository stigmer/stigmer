/**
 * The RunStarter — ports pkg/domain/schedule/temporal/runstarter.go: turns
 * one schedule fire into one AgentExecution through the in-process gRPC
 * client, so the FULL create pipeline runs (session auto-create, execution
 * context, persist, workflow start). Where the cloud starter mints a
 * schedule token and re-enters the pipeline behind FGA gates, OSS has no
 * caller identity by design (DD-015 D-G): the org is stamped from the
 * schedule's own metadata.
 *
 * Idempotency is the CLOCK's job here (DD-015 D-F): the OSS create
 * pipeline deliberately has no duplicate check (it would tax every
 * execution create in the product), so the starter looks up its own
 * deterministic execution name before creating. Within one tick activity
 * retries are sequential, and across fires the nominal time disambiguates —
 * one reminder per fire, by construction.
 *
 * Serves BOTH fire paths: the tick's start-run activity (origin=cron) and
 * the trigger RPC's direct-run step (origin=manual, DD-017 D-5).
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSpecSchema,
  ExecutionConfigSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { ApprovalMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  ServiceTier,
  ThinkingMode,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { AgentInvocation } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/invocation_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import type { Logger } from "../../boot/logger.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { ScheduleTemporalConfig } from "./config.js";
import { scheduleModelPinningRefusal } from "./model-pinning.js";
import { ensureStatus, bumpStatusAudit } from "./status-writes.js";

/**
 * The scheduled session's pinned subject prefix — cross-edition contract
 * (an explicit subject also opts the session out of LLM titling,
 * deliberately: a reminder session names itself). Go SessionSubjectPrefix.
 */
export const SESSION_SUBJECT_PREFIX = "Scheduled run: ";

/**
 * The audit link stamped on every schedule-created execution — the same
 * key the cloud edition's scope step writes (Go ScheduleIDLabelKey).
 *
 * In OSS the label is also the environment-resolution key: the execution
 * context step reads it to merge the schedule's environment_refs (DD-017
 * D-4). Cloud deliberately resolves through the validated token claim
 * instead — a client-suppliable label must not widen what a cloud sandbox
 * reads — but OSS is single-user with no trust boundary, and it has no
 * tokens to carry a claim (the DD-015 divergence posture).
 */
export const SCHEDULE_ID_LABEL_KEY = "stigmer.ai/schedule-id";

/** The sealed outcome set of startRun (Go RunOutcomeResult). */
export type RunOutcomeResult =
  /** The run exists (created now, or found from a prior attempt at the same fire). */
  | { kind: "started"; executionId: string; alreadyExisted: boolean }
  /** The referenced agent no longer exists — the deterministic dangling-reference failure (no cascade by contract). */
  | { kind: "targetMissing"; reason: string }
  /** A launch gate refused deterministically — retrying cannot help, the streak should know. */
  | { kind: "refused"; reason: string };

/**
 * The narrow slice of the in-process agent-execution client the run
 * starter needs (Go ExecutionCreator; satisfied through
 * src/boot/inprocess.ts).
 */
export interface ScheduleExecutionCreator {
  create(execution: AgentExecution): Promise<AgentExecution>;
}

/**
 * THE idempotency key: schedule id (lowercased, underscores to hyphens —
 * already slug-safe) plus the nominal fire time truncated to whole seconds
 * in the cloud's "yyyyMMdd't'HHmmss'z'" layout. Byte-identical to the
 * cloud's scheduledExecutionName, pinned by tests on both sides: two
 * editions must never name the same fire's run differently (Go
 * ScheduledExecutionName).
 */
export function scheduledExecutionName(
  scheduleResourceId: string,
  nominalFireTime: Date,
): string {
  const idPart = scheduleResourceId.toLowerCase().replaceAll("_", "-");
  return `${idPart}-${executionNameFireTime(nominalFireTime)}`;
}

/** Go executionNameFireTimeLayout "20060102t150405z", UTC whole seconds. */
function executionNameFireTime(nominal: Date): string {
  const p = utcParts(nominal);
  return `${p.year}${p.month}${p.day}t${p.hour}${p.minute}${p.second}z`;
}

/**
 * Appends the fire-context line to the schedule's message, rendered in the
 * schedule's own time zone (an unloadable zone degrades to UTC — a
 * slightly wrong-timezone reminder beats a dead fire). Format-pinned: Go
 * and the cloud produce the identical bytes, and the runner injects no
 * current date into any prompt — this line is the ONLY way the model knows
 * "today" (Go ComposeMessage, fireContextLayout "Monday, 2006-01-02 15:04").
 */
export function composeMessage(
  schedule: Schedule,
  nominalFireTime: Date,
): string {
  const requested = schedule.spec?.timeZone ?? "";
  const { zoneName, formatted } = fireContextLine(requested, nominalFireTime);
  const baseMessage = invocationOf(schedule)?.message ?? "";
  return `${baseMessage}\n\n(Scheduled fire time: ${formatted} (${zoneName}))`;
}

/**
 * Renders "Monday, 2006-01-02 15:04" in the zone, with Go's zone-name
 * echo: LoadLocation("") is UTC and prints "UTC"; an unloadable name
 * degrades to UTC (ComposeMessage's fallback); a loadable name echoes
 * byte-for-byte as given.
 */
function fireContextLine(
  requestedZone: string,
  nominal: Date,
): { zoneName: string; formatted: string } {
  let zone = requestedZone;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fireContextFormatter(zone === "" ? "UTC" : zone).formatToParts(nominal);
    if (zone === "") {
      zone = "UTC";
    }
  } catch {
    zone = "UTC";
    parts = fireContextFormatter("UTC").formatToParts(nominal);
  }
  const get = (type: Intl.DateTimeFormatPart["type"]): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const formatted = `${get("weekday")}, ${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  return { zoneName: zone, formatted };
}

function fireContextFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function utcParts(date: Date): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
} {
  const pad = (value: number, width: number): string =>
    String(value).padStart(width, "0");
  return {
    year: pad(date.getUTCFullYear(), 4),
    month: pad(date.getUTCMonth() + 1, 2),
    day: pad(date.getUTCDate(), 2),
    hour: pad(date.getUTCHours(), 2),
    minute: pad(date.getUTCMinutes(), 2),
    second: pad(date.getUTCSeconds(), 2),
  };
}

function invocationOf(schedule: Schedule): AgentInvocation | undefined {
  return schedule.spec?.target.case === "agent"
    ? schedule.spec.target.value
    : undefined;
}

export interface RunStarterDeps {
  readonly store: Store;
  readonly config: ScheduleTemporalConfig;
  readonly executions: ScheduleExecutionCreator;
  readonly logger: Logger;
}

export class RunStarter {
  constructor(private readonly deps: RunStarterDeps) {}

  /**
   * Starts (or finds) this fire's run and stamps status.last_execution_id.
   * Deterministic refusals come back as outcomes (the streak should count
   * them); infrastructure failures come back as thrown errors (the tick
   * activity retries, the deterministic name absorbs it). Go StartRun.
   */
  async startRun(
    schedule: Schedule,
    nominalFireTime: Date,
  ): Promise<RunOutcomeResult> {
    const { store, logger } = this.deps;
    const scheduleId = schedule.metadata?.id ?? "";
    const org = schedule.metadata?.org ?? "";

    const resolved = await this.resolveTargetAgent(schedule);
    if (resolved.agent === undefined) {
      logger.warn("Schedule fire has no target agent", {
        schedule_id: scheduleId,
        reason: resolved.missingReason,
      });
      return { kind: "targetMissing", reason: resolved.missingReason };
    }

    // Launch backstop of the unattended model-pinning rule (#362):
    // write-time validation holds this bar on every create and update, but
    // rows written before the rule existed must refuse here rather than
    // run Auto at the account default's price. A deterministic refusal
    // feeds the failure streak, so a broken config pauses the schedule
    // instead of burning silently every fire.
    const pinningRefusal = scheduleModelPinningRefusal(schedule.spec);
    if (pinningRefusal !== "") {
      logger.error("Schedule fire refused by the model-pinning backstop", {
        schedule_id: scheduleId,
        reason: pinningRefusal,
      });
      return { kind: "refused", reason: pinningRefusal };
    }

    const executionName = scheduledExecutionName(scheduleId, nominalFireTime);

    // The clock's own idempotency: a retried activity (or a duplicated
    // fire at the same nominal time) finds the winner instead of sending
    // the reminder twice. The deterministic name IS the execution's slug
    // (every character is already slug-shaped, pinned by test).
    let existing;
    try {
      existing = await findResourceBySlug(
        store,
        ApiResourceKind.agent_execution,
        AgentExecutionSchema,
        executionName,
        org,
      );
    } catch (error) {
      // Go's wrap label (runstarter.go): the activity retries either way;
      // the label keeps history/trigger diagnostics identical.
      throw new Error(
        `look up execution ${executionName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (existing !== undefined) {
      const executionId = existing.metadata?.id ?? "";
      logger.info("Schedule fire already has its execution (idempotent retry)", {
        schedule_id: scheduleId,
        execution_id: executionId,
      });
      await this.stampLastExecutionId(scheduleId, executionId);
      return { kind: "started", executionId, alreadyExisted: true };
    }

    let created: AgentExecution;
    try {
      created = await this.deps.executions.create(
        this.buildExecutionRequest(schedule, resolved.agent, executionName, nominalFireTime),
      );
    } catch (error) {
      if (!(error instanceof ConnectError)) {
        throw error;
      }
      switch (error.code) {
        case Code.AlreadyExists: {
          // The session auto-create's duplicate check can refuse even
          // though the execution create has none — re-read the winner. A
          // re-find ERROR carries the same diagnostic wrapper as a missing
          // winner (Go wraps findErr != nil || !found identically).
          let winner;
          try {
            winner = await findResourceBySlug(
              store,
              ApiResourceKind.agent_execution,
              AgentExecutionSchema,
              executionName,
              org,
            );
          } catch (findError) {
            throw new Error(
              `duplicate-check refusal but no execution row for ${executionName}: ${findError instanceof Error ? findError.message : String(findError)}`,
              { cause: findError },
            );
          }
          if (winner === undefined) {
            throw new Error(
              `duplicate-check refusal but no execution row for ${executionName}: ${error.message}`,
              { cause: error },
            );
          }
          const executionId = winner.metadata?.id ?? "";
          await this.stampLastExecutionId(scheduleId, executionId);
          return { kind: "started", executionId, alreadyExisted: true };
        }
        case Code.FailedPrecondition:
        case Code.PermissionDenied:
        case Code.NotFound:
        case Code.InvalidArgument:
        case Code.ResourceExhausted:
          logger.error("Schedule fire refused by a launch gate", {
            schedule_id: scheduleId,
            org,
            code: Code[error.code],
            reason: error.rawMessage,
          });
          return { kind: "refused", reason: error.rawMessage };
        default:
          throw error;
      }
    }

    const executionId = created.metadata?.id ?? "";
    await this.stampLastExecutionId(scheduleId, executionId);
    return { kind: "started", executionId, alreadyExisted: false };
  }

  /**
   * Loads the referenced agent, the reference's org defaulting to the
   * schedule's own. An undefined agent with a reason means the
   * deterministic dangling-reference failure (Go resolveTargetAgent).
   */
  private async resolveTargetAgent(
    schedule: Schedule,
  ): Promise<{ agent?: Agent; missingReason: string }> {
    const ref = invocationOf(schedule)?.agentRef;
    const slug = ref?.slug ?? "";
    if (slug === "") {
      return { missingReason: "schedule has no agent target" };
    }
    let org = ref?.org ?? "";
    if (org === "") {
      org = schedule.metadata?.org ?? "";
    }
    let agent: Agent | undefined;
    try {
      agent = await findResourceBySlug(
        this.deps.store,
        ApiResourceKind.agent,
        AgentSchema,
        slug,
        org,
      );
    } catch (error) {
      throw new Error(
        `resolve target agent ${org}/${slug}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (agent === undefined) {
      // The deterministic start-failure copy — cross-edition contract (the
      // conformance firing suite asserts the pause reason built from it,
      // byte-for-byte).
      return { missingReason: `target agent ${org}/${slug} not found` };
    }
    return { agent, missingReason: "" };
  }

  /**
   * Shapes the run: fresh session per fire with the pinned subject, the
   * fire-context message, and the unattended execution profile.
   * approval_mode=UNATTENDED is a correctness requirement, not a
   * preference: a gated tool with no approver would park the execution
   * forever (the agent workflow deliberately has no run timeout), which
   * under tracking becomes a silently-burned budget every fire (Go
   * buildExecutionRequest).
   */
  private buildExecutionRequest(
    schedule: Schedule,
    agent: Agent,
    executionName: string,
    nominalFireTime: Date,
  ): AgentExecution {
    const invocation = invocationOf(schedule);
    const runConfig = invocation?.runConfig;

    const executionConfig = create(ExecutionConfigSchema, {
      approvalMode: ApprovalMode.UNATTENDED,
      // The platform profile, then the schedule's own run_config CLAMPED
      // by it (DD-017 D-3): per field, min(owner, platform) when the
      // platform cap is set; the owner value stands when the platform cap
      // is unset. The owner can lower spend, never raise it past the
      // platform.
      maxToolRounds: clampedRunBound(
        runConfig?.maxToolRounds ?? 0,
        this.deps.config.executionProfileMaxToolRounds,
      ),
      maxCostUsd: clampedRunBound(
        runConfig?.maxCostUsd ?? 0,
        this.deps.config.executionProfileMaxCostUsd,
      ),
    });
    const model = (runConfig?.modelName ?? "").trim();
    if (model !== "") {
      executionConfig.modelName = model;
    }
    // service_tier stamps when the owner set one — there is no platform
    // tier knob (unset resolves to STANDARD in the runner, never the
    // provider account default). Tier-model coherence was validated
    // fail-closed at execution create (#357).
    if (
      runConfig !== undefined &&
      runConfig.serviceTier !== ServiceTier.UNSPECIFIED
    ) {
      executionConfig.serviceTier = runConfig.serviceTier;
    }
    // thinking_mode under the same contract as service_tier: only when the
    // owner set one; capability-model coherence was validated fail-closed
    // at execution create (#772).
    if (
      runConfig !== undefined &&
      runConfig.thinkingMode !== ThinkingMode.UNSPECIFIED
    ) {
      executionConfig.thinkingMode = runConfig.thinkingMode;
    }

    // The fresh per-fire session speaks the invocation's session half
    // (DD-018 D-3): harness and workspace come from the owner's spec. An
    // unspecified harness stays unset — the platform default applies (OSS:
    // native). Workspace entries are git-only by write-time validation;
    // credentials, when a repo is private, ride an org-shared environment
    // holding GITHUB_TOKEN (DD-018 D-4).
    const sessionSpec = create(SessionSpecSchema, {
      subject: SESSION_SUBJECT_PREFIX + (schedule.metadata?.slug ?? ""),
      workspaceEntries: invocation?.workspaceEntries ?? [],
    });
    if (
      invocation !== undefined &&
      invocation.harness !== Harness.UNSPECIFIED
    ) {
      sessionSpec.harness = invocation.harness;
    }

    return create(AgentExecutionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
      metadata: create(ApiResourceMetadataSchema, {
        name: executionName,
        // Cloud deliberately omits the org (its token scope step forces it
        // from the validated claim); OSS has no token, so the schedule's
        // own org is stamped directly — it is load-bearing for the session
        // and execution context.
        org: schedule.metadata?.org ?? "",
        // The audit link (DD-008 D4) AND this edition's
        // environment-resolution key — see SCHEDULE_ID_LABEL_KEY.
        labels: { [SCHEDULE_ID_LABEL_KEY]: schedule.metadata?.id ?? "" },
      }),
      spec: create(AgentExecutionSpecSchema, {
        agentId: agent.metadata?.id ?? "",
        message: composeMessage(schedule, nominalFireTime),
        sessionSpec,
        executionConfig,
      }),
    });
  }

  /**
   * Records the run pointer on status. Failing this write throws so the
   * activity retries and converges the pointer — the deterministic name
   * makes the retry harmless (Go stampLastExecutionID).
   */
  private async stampLastExecutionId(
    scheduleId: string,
    executionId: string,
  ): Promise<void> {
    try {
      await this.deps.store.updateResource(
        ApiResourceKind.schedule,
        scheduleId,
        ScheduleSchema,
        (live) => {
          const status = ensureStatus(live);
          status.lastExecutionId = executionId;
          bumpStatusAudit(status);
        },
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return; // deleted mid-fire: nothing to stamp
      }
      throw new Error(
        `stamp last_execution_id on schedule ${scheduleId}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
}

/**
 * Merges one owner-set run bound with its platform cap: zero (or negative)
 * means "unset" on either side, and when both are set the LOWER value wins
 * — the platform profile is a guardrail, never a floor (Go
 * clampedRunBoundInt/Float, one function here because JS numbers carry
 * both).
 */
export function clampedRunBound(owner: number, platform: number): number {
  if (owner <= 0) {
    return Math.max(platform, 0);
  }
  if (platform <= 0) {
    return owner;
  }
  return Math.min(owner, platform);
}
