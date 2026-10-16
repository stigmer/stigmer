/**
 * UpdateStatus — ports controller/update_status.go: the runner's
 * progressive status-update RPC and the domain's single merge chokepoint.
 *
 * Chain: Authorize → ValidateUpdateStatusInput → AdmitLoadedVersions →
 * MergeAndPersistExecution → NotifyStatusObservers. The merge+persist is
 * ONE atomic read-modify-write under the store's per-resource write lock
 * (updateRunAppendingEvents), so a decision or an answer recorded
 * concurrently is never lost to a stale copy.
 *
 * The status-transition hooks are consumed here — one of the notifying
 * sites (the exhaustive list: status-observers.ts): observers fire
 * post-persist; the response decorators run on the reply (the querySignal
 * seam — a composition piggybacks its control signal on this response;
 * OSS answers UNSPECIFIED).
 *
 * applyUpdateStatusMerge is the merge body run inside the write (and
 * exercised directly by the guard tests): most fields are replaced with
 * the runner's latest, presence-guarded. What the agent said and did is
 * the session's event log, which the runner appends to itself; the run
 * holds the turn's lifecycle, its stamps and its file record. A PAUSED
 * execution's phase moves only on the platform's own write
 * (stigmer#1370): the runner learns of a pause on a later heartbeat and
 * keeps streaming IN_PROGRESS until then, and without the latch its
 * stragglers un-pause the execution and Resume finds nothing to resume.
 *
 * loaded_versions is merged by union rather than replaced: every attempt
 * of a turn resolves its skills and plugins again, so a turn resumed after
 * a pause may load a newer version than it started on, and a run that ran
 * two versions of one skill must say both. Its entries are admitted first
 * (AdmitLoadedVersions): updateStatus is open to whoever may edit the
 * run, not only the runner, and every read names each stored entry with
 * its target's current slug, so an entry the reference rule would refuse
 * from the run's organization (another organization's resource, a
 * parent's not shared with its children, an id nothing holds) is dropped,
 * never stored and never named.
 *
 * file_changes, the run's file record (filereview/record.ts), is merged
 * by change set id: a set the write carries replaces the one with its id,
 * a new one is added, and no stored set is ever removed. The record
 * carries no decision; the policy keeps decide from the session's log:
 *
 *   - A write whose record carries a captured set reads, under the
 *     session's lock, the run's decided events and answers
 *     (filereview/logged.ts) and runs the policy keeps
 *     (filereview/autokeep.ts) there and only there, so a set is kept, or
 *     left for a person, in the write that captured it. Each keep is a
 *     `stigmer.file_review.decided` event the write appends after its
 *     status events.
 *   - A turn's file review closes when a later message is sent
 *     (keepOutdatedSets). The next turn's workflow closes a turn that
 *     already captured; a turn that captures after the later message was
 *     sent is closed here, as it captures: such a write asks the store for
 *     the run of the session's newest `user.message`, and keeps the run's
 *     undecided sets in the same write when that run is another. No other
 *     write pays either read.
 */
import { create } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  LoadedVersionsSchema,
  RunSchema,
  RunStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import {
  RunControlSignal,
  RunPhase,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type {
  RunUpdateStatusInput,
  UpdateStatusResponse,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { UpdateStatusResponseSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type {
  RunResponseDecorator,
  RunStatusObserver,
} from "../../extensions/status-hooks.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import { isServerComposedRequest } from "../../extensions/identity.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import {
  checkReference,
  loadReferenceTargets,
  type SpecReference,
} from "../../pipeline/steps/references.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

import {
  autoKeepApprovedCommandSets,
  autoKeepEvalRunTrySets,
  keepOutdatedSets,
} from "./filereview/autokeep.js";
import { isEvalRun } from "../eval-run/run-label.js";
import { RUN_REVIEW_EVENT_TYPES, runReviewLogOf, withDecisions } from "./filereview/logged.js";
import type { RunReviewLog } from "./filereview/logged.js";
import { reconcileFileChangeProgress } from "./filereview/progress.js";
import { isCaptured, upsertFileChanges } from "./filereview/record.js";
import { isTerminalExecutionPhase } from "./phases.js";
import {
  applyResponseDecorators,
  notifyStatusObservers,
} from "./status-observers.js";
import type { SessionEventBroker } from "../session/events/broker.js";
import { eventOf } from "../session/events/codec.js";
import { updateRunAppendingEvents } from "../session/events/run-writes.js";

export interface UpdateStatusDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it. */
  readonly authorizer: Authorizer;
  /** The fan-out of each session's event log (the merge appends its session's status events). */
  readonly sessionEventBroker: SessionEventBroker;
  /** The composed status-transition observers. */
  readonly statusObservers: ReadonlyArray<RunStatusObserver>;
  /** The composed reply decorators — the querySignal seam. */
  readonly responseDecorators: ReadonlyArray<RunResponseDecorator>;
}

type UpdateStatusDesc =
  typeof RunCommandController.method.updateStatus.input;

const EXECUTION_KEY = "execution";
// An internal handoff (not a ported Go key): the phase read inside the
// updateResource closure BEFORE the merge mutates, for the observer step.
const OLD_PHASE_KEY = "o4OldPhase";

export async function updateStatus(
  deps: UpdateStatusDeps,
  input: RunUpdateStatusInput,
  identity: CallerIdentity,
): Promise<UpdateStatusResponse> {
  const reqCtx = new RequestContext(
    RunCommandController.method.updateStatus.input,
    input,
    identity,
    ApiResourceKind.run,
  );
  await newPipeline<UpdateStatusDesc>(
    "agentexecution-update-status",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        RunCommandController.method.updateStatus,
        deps.authorizer,
      ),
    )
    .addStep({
      name: "ValidateUpdateStatusInput",
      execute(ctx) {
        if (ctx.input.runId === "") {
          throw invalidArgumentError("run_id is required");
        }
        if (ctx.input.status === undefined) {
          throw invalidArgumentError("status is required");
        }
      },
    })
    .addStep({
      name: "AdmitLoadedVersions",
      async execute(ctx) {
        await admitLoadedVersions(deps.store, ctx.input, deps.logger);
      },
    })
    .addStep({
      name: "MergeAndPersistExecution",
      async execute(ctx) {
        let updated: Run;
        let oldPhase = RunPhase.RUN_PHASE_UNSPECIFIED;
        try {
          // The merge commits with the session's status events when it
          // changes whether the run is working (session/events/run-writes.ts).
          // A write carrying a captured set asks for the conversation's
          // newest turn and the run's decisions, so its policy keeps run
          // and a late capture of an outdated turn is kept as it lands
          // (module header).
          const captures = carriesCapture(ctx.input);
          ({ run: updated, previousPhase: oldPhase } = await updateRunAppendingEvents(
            deps,
            ctx.input.runId,
            (execution, session) => ({
              last: applyUpdateStatusMerge(
                execution,
                ctx.input,
                deps.logger,
                isServerComposedRequest(identity) ? "platform" : "wire",
                captures && isOutdatedTurn(ctx.input.runId, session.runOfNewestType),
                captures ? runReviewLogOf(session.runEvents.map(eventOf)) : undefined,
              ),
            }),
            captures
              ? { runOfNewestType: NEWEST_TURN_EVENT_TYPE, runEventTypes: RUN_REVIEW_EVENT_TYPES }
              : {},
          ));
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw notFoundError("Run", ctx.input.runId);
          }
          throw internalError(error, "failed to update execution status");
        }
        // Hand the merged result to the observer step and the reply.
        ctx.set(EXECUTION_KEY, updated);
        ctx.set(OLD_PHASE_KEY, oldPhase);
      },
    })
    .addStep({
      name: "NotifyStatusObservers",
      async execute(ctx) {
        const execution = ctx.get(EXECUTION_KEY) as Run | undefined;
        /* v8 ignore next 6 -- @preserve: the merge step sets the key or throws, so only a reordered chain reaches this */
        if (execution === undefined) {
          throw internalError(
            new Error("execution not found in context"),
            "execution not found in context",
          );
        }
        await notifyStatusObservers(
          deps,
          execution,
          ctx.get(OLD_PHASE_KEY) as RunPhase,
          execution.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED,
        );
      },
    })
    .build()
    .execute(reqCtx);

  // The decorator seam: a composition contributes its control signal to
  // fields the shared reply schema already carries; the OSS baseline
  // (UNSPECIFIED) is byte-identical when no decorator is composed.
  return applyResponseDecorators(
    deps.responseDecorators,
    deps.logger,
    reqCtx.get(EXECUTION_KEY) as Run,
    create(UpdateStatusResponseSchema, {
      signal: RunControlSignal.UNSPECIFIED,
    }),
  );
}

/**
 * The policy keeps of a write that carries a captured set, decided from
 * the run's log (`log`, read under the session's lock) against the merged
 * record: the approved-command keep, the eval-run try's keep, and, for
 * a turn a later message outdated, the close of its review. Each keep's
 * decisions are folded into the log the next decides from, so two rules
 * never decide one target in one write. Returns the decided events.
 */
function applyPolicyKeeps(
  execution: Run,
  runId: string,
  logger: Logger,
  outdatedTurn: boolean,
  log: RunReviewLog,
): SessionEvent[] {
  const sets = execution.status?.fileChanges ?? [];
  // Approved-command keep: a captured set whose provenance verifies
  // against the person's answers in the log is decided IN THE SAME WRITE
  // that captured it.
  const approved = autoKeepApprovedCommandSets(sets, runId, execution.spec?.autoApproveAll ?? false, logger, log);
  let seen = withDecisions(log, approved);
  // An eval run's try keeps its edits by policy: nobody reviews a try.
  const evalTry = autoKeepEvalRunTrySets(sets, runId, isEvalRun(execution), logger, seen);
  seen = withDecisions(seen, evalTry);
  // A turn that captured after a later message was sent is closed as it
  // lands: its undecided edits are kept, as the next turn keeps them.
  const outdated = outdatedTurn ? keepOutdatedSets(sets, runId, seen) : [];
  if (outdated.length > 0) {
    logger.info("Kept a turn's undecided file changes: a later message was sent", {
      executionId: runId,
      decisions: outdated.length,
    });
  }
  return [...approved, ...evalTry, ...outdated];
}

/** The event that names the conversation's newest turn: the user message its run was created with. */
const NEWEST_TURN_EVENT_TYPE = "user.message";

/** Whether the incoming status carries a captured set for the run's file record. */
function carriesCapture(input: RunUpdateStatusInput): boolean {
  return (input.status?.fileChanges ?? []).some(isCaptured);
}

/**
 * Whether a later message was sent after this run's: the session's newest
 * `user.message` belongs to another run. A session with none (a run in no
 * session) has no later turn.
 */
function isOutdatedTurn(runId: string, newestTurnRunId: string | undefined): boolean {
  return newestTurnRunId !== undefined && newestTurnRunId !== runId;
}

/**
 * Who sent a status write: the platform's own (the invoke workflow's
 * writes, which reach this handler over the in-process transport, the
 * one origin the wire cannot claim) or the wire (the runner).
 */
export type StatusWriter = "platform" | "wire";

/**
 * Merges an incoming status update into the execution in place, exactly
 * the runner's merge rules (module header). Runs inside the locked write
 * (synchronous by store contract), so the merge and the policy keeps see
 * the snapshot that will be persisted. `writer` defaults to the wire, the
 * side that grants nothing extra. `outdatedTurn` says a later message was
 * sent after this run's, so its file review is closed in this write;
 * `reviewLog` is the run's decisions and answers in the session's log,
 * given only to a write that carries a captured set, which alone runs the
 * policy keeps (both read under the session's lock). Returns the
 * `stigmer.file_review.decided` events the keeps decided, for the write to
 * append.
 */
export function applyUpdateStatusMerge(
  execution: Run,
  input: RunUpdateStatusInput,
  logger: Logger,
  writer: StatusWriter = "wire",
  outdatedTurn = false,
  reviewLog?: RunReviewLog,
): SessionEvent[] {
  if (execution.status === undefined) {
    execution.status = create(RunStatusSchema);
  }
  const status = execution.status;
  const requestStatus = input.status;
  if (requestStatus === undefined) {
    // Unreachable through the RPC (the validate step refuses); the
    // direct-call guard keeps the merge total.
    return [];
  }
  const existingPhase = status.phase;

  // Artifacts are published by agents via publish_artifact during
  // execution; the runner persists them through this RPC.
  if (requestStatus.artifacts.length > 0) {
    status.artifacts = requestStatus.artifacts;
  }
  // Write-backs are populated during post-execution processing when the
  // platform detects git changes and creates PRs.
  if (requestStatus.workspaceWriteBacks.length > 0) {
    status.workspaceWriteBacks = requestStatus.workspaceWriteBacks;
  }

  // Update phase (if provided) — latched once terminal. A terminal phase
  // is final by contract, but a runner activity can outlive its
  // workflow's termination, so a straggler streaming persist can arrive
  // carrying IN_PROGRESS after Terminate already wrote TERMINATED.
  // Without the latch that persist resurrects the phase — and the
  // execution is stuck live forever, because the workflow that would
  // re-terminalize it is gone. Recover is the one sanctioned
  // un-terminalizer and runs through its own lifecycle step, never this
  // merge.
  //
  // A PAUSED execution is latched the same way against the wire
  // (stigmer#1370): the runner's straggler persists, sent before its
  // heartbeat delivers the pause, carry IN_PROGRESS. Resume moves the
  // phase through its own lifecycle step; through this merge only the
  // platform's own writes do (the workflow's resume and recovery
  // re-assertions, which also heal a stale PAUSED over a fast resume,
  // oss#869).
  if (requestStatus.phase !== RunPhase.RUN_PHASE_UNSPECIFIED) {
    if (
      existingPhase === RunPhase.RUN_PAUSED &&
      writer === "wire" &&
      requestStatus.phase !== existingPhase
    ) {
      logger.warn(
        "Ignored a wire phase change on a paused execution; Resume or the platform's own write moves it",
        {
          executionId: input.runId,
          ignoredPhase: RunPhase[requestStatus.phase],
        },
      );
    } else if (
      isTerminalExecutionPhase(existingPhase) &&
      requestStatus.phase !== existingPhase
    ) {
      logger.warn(
        "Ignored phase change on a terminal execution; terminal phases are final (Recover is the sanctioned un-terminalizer)",
        {
          executionId: input.runId,
          storedPhase: RunPhase[existingPhase],
          ignoredPhase: RunPhase[requestStatus.phase],
        },
      );
    } else {
      status.phase = requestStatus.phase;
    }
  }

  if (requestStatus.error !== "") {
    status.error = requestStatus.error;
  }
  if (requestStatus.stopCause !== "") {
    status.stopCause = requestStatus.stopCause;
  }
  if (requestStatus.startedAt !== "") {
    status.startedAt = requestStatus.startedAt;
  }
  if (requestStatus.completedAt !== "") {
    status.completedAt = requestStatus.completedAt;
  }

  // Defense-in-depth: completed_at must not be set for non-terminal
  // phases. The runner clears completed_at on resume, but the
  // empty-string merge above cannot propagate the clear — this guard
  // prevents the contradictory state (completed_at set +
  // phase=WAITING_FOR_APPROVAL) observed in production.
  if (
    status.phase === RunPhase.RUN_IN_PROGRESS ||
    status.phase === RunPhase.RUN_WAITING_FOR_APPROVAL ||
    status.phase === RunPhase.RUN_PENDING
  ) {
    status.completedAt = "";
    // A turn that works again has not stopped: a resumed pause drops its
    // cause, so the turn's next stop is read alone.
    status.stopCause = "";
  }

  // The file record, merged by change set id: nothing stored is removed
  // (module header).
  if (requestStatus.fileChanges.length > 0) {
    status.fileChanges = upsertFileChanges(input.runId, status.fileChanges, requestStatus.fileChanges);
  }

  // The policy keeps run in the write that carries a captured set, which
  // reads the run's log for them (module header).
  const decided =
    reviewLog === undefined ? [] : applyPolicyKeeps(execution, input.runId, logger, outdatedTurn, reviewLog);

  // Mid-run live capture: merge the runner-owned transient progress
  // snapshot (presence-guarded replace, like streaming_usage below), then
  // clear it once its change set is captured on the record or the run has
  // finished.
  if (requestStatus.fileChangeProgress !== undefined) {
    status.fileChangeProgress = requestStatus.fileChangeProgress;
  }
  status.fileChangeProgress = reconcileFileChangeProgress(
    status.fileChanges,
    status.fileChangeProgress,
    isTerminalExecutionPhase(status.phase),
  );

  // Merge streaming_usage (replace with latest from request): a
  // display-only fallback when proxy-reported usage is unavailable.
  if (requestStatus.streamingUsage !== undefined) {
    status.streamingUsage = requestStatus.streamingUsage;
  }

  if (requestStatus.setupProgress !== undefined) {
    status.setupProgress = requestStatus.setupProgress;
  }
  // Clear setup_progress when phase leaves PENDING (defense-in-depth):
  // the worker stops sending it once streaming begins, but an explicit
  // clear prevents stale data if the phase transitions via a different
  // code path.
  if (status.phase !== RunPhase.RUN_PENDING) {
    status.setupProgress = undefined;
  }

  // Merge eval_files: the files a eval-run try's graders read, as
  // its turn left them. Runner-owned and written with each terminal write;
  // kept only on a try's run, the one run the case workflow grades.
  if (requestStatus.evalFiles !== undefined && execution.spec?.evalCase !== undefined) {
    status.evalFiles = requestStatus.evalFiles;
  }

  // Merge loaded_versions: runner-owned, sent with every write of a turn
  // attempt. A union over (id, version), never a replace: a resumed attempt
  // that loads a moved head adds the version it ran beside the one before,
  // and a resend of the same list adds nothing.
  if (requestStatus.loadedVersions !== undefined) {
    const loaded = status.loadedVersions ?? create(LoadedVersionsSchema);
    loaded.skills = unionReferences(
      loaded.skills,
      requestStatus.loadedVersions.skills,
      ApiResourceKind.skill,
    );
    loaded.plugins = unionReferences(
      loaded.plugins,
      requestStatus.loadedVersions.plugins,
      ApiResourceKind.plugin,
    );
    status.loadedVersions = loaded;
  }

  logger.debug("Merged status fields", {
    executionId: input.runId,
    phase: RunPhase[status.phase],
    changeSets: status.fileChanges.length,
    decided: decided.length,
  });
  return decided;
}

/**
 * The stored list followed by every incoming entry whose (id, version) it
 * does not hold, in the order sent. Stored entries are never removed or
 * reordered. Each appended entry takes its stored form: the list's kind,
 * no slug (the response interceptor names it).
 */
function unionReferences(
  stored: readonly ApiResourceReference[],
  incoming: readonly ApiResourceReference[],
  kind: ApiResourceKind,
): ApiResourceReference[] {
  const merged = [...stored];
  const held = new Set(stored.map((ref) => `${ref.id}@${ref.version}`));
  for (const ref of incoming) {
    const key = `${ref.id}@${ref.version}`;
    if (held.has(key)) {
      continue;
    }
    held.add(key);
    merged.push(
      create(ApiResourceReferenceSchema, {
        org: ref.org,
        kind,
        id: ref.id,
        version: ref.version,
      }),
    );
  }
  return merged;
}

/**
 * Keeps, in a write's loaded_versions, only the entries the run may hold:
 * those it holds already, and new ones the reference rule admits from the
 * run's organization (`checkReference`: a resource of its own organization
 * that exists, or one its parent shares with child organizations). Each new
 * target is read once; a write that adds nothing new reads nothing but the
 * run. The floor clause does not apply: the run did load what it lists, and
 * the floor guards what a spec exposes. A dropped entry is logged, never
 * refused, so a skill deleted mid-turn cannot fail the turn's later writes.
 */
export async function admitLoadedVersions(
  store: Store,
  input: RunUpdateStatusInput,
  logger: Logger,
): Promise<void> {
  const loaded = input.status?.loadedVersions;
  if (loaded === undefined || (loaded.skills.length === 0 && loaded.plugins.length === 0)) {
    return;
  }
  let run: Run;
  try {
    run = await store.getResource(ApiResourceKind.run, input.runId, RunSchema);
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      // The merge answers NotFound for the same read.
      return;
    }
    /* v8 ignore next -- @preserve: a store fault other than a missing row; no test injects one here */
    throw internalError(error, "failed to read the run");
  }
  const runOrg = run.metadata?.org ?? "";
  const held = new Set(
    [...(run.status?.loadedVersions?.skills ?? []), ...(run.status?.loadedVersions?.plugins ?? [])].map(
      (ref) => `${ref.id}@${ref.version}`,
    ),
  );
  const lists = [
    [ApiResourceKind.skill, loaded.skills],
    [ApiResourceKind.plugin, loaded.plugins],
  ] as const;
  const fresh: SpecReference[] = lists.flatMap(([kind, refs]) =>
    refs
      .filter((ref) => !held.has(`${ref.id}@${ref.version}`))
      .map((ref) => ({ kind, org: ref.org, id: ref.id, slug: "" })),
  );
  if (fresh.length === 0) {
    return;
  }
  const targets = await loadReferenceTargets(store, fresh, runOrg);
  const parent = { org: runOrg, visibility: run.metadata?.visibility ?? 0 };
  const admits = (kind: ApiResourceKind, ref: ApiResourceReference): boolean => {
    if (held.has(`${ref.id}@${ref.version}`)) {
      return true;
    }
    const verdict = checkReference(targets, parent, { kind, org: ref.org, id: ref.id, slug: "" });
    if (verdict.kind === "ok" || verdict.kind === "below-floor") {
      return true;
    }
    logger.warn("Dropped a loaded version the run's organization may not reference", {
      executionId: input.runId,
      kind: ApiResourceKind[kind],
      id: ref.id,
      verdict: verdict.kind,
    });
    return false;
  };
  loaded.skills = loaded.skills.filter((ref) => admits(ApiResourceKind.skill, ref));
  loaded.plugins = loaded.plugins.filter((ref) => admits(ApiResourceKind.plugin, ref));
}
