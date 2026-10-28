/**
 * The test-facing seam of the harness contract kit.
 *
 * `HarnessAdapter.runTurn(input, sink)` gives a test no way to make the
 * engine DO anything: propose a gated action, emit usage, hang, fail. The
 * approval-contract kit met the same problem with `GatewaySubstrate` — a
 * small interface each real substrate adapts so one invariant catalog can
 * drive all of them. This is that seam for harnesses: a
 * {@link HarnessContractSubject} owns the ENGINE (what the next turn will
 * do), and the kit owns everything the runtime would own (the sink, the
 * `TurnInput`, the state id threading, the reinvocation).
 *
 * The scenario vocabulary is deliberately small and engine-neutral: it says
 * what the kit needs to PROVOKE, never how an engine behaves. The scripted
 * fake consumes it directly; a real harness's subject translates it onto that
 * harness's own double (the native subject onto a scripted model,
 * `execute-deep-agent/__test-utils__/contract-subject.ts`). One vocabulary, not one per
 * engine, so the kit cannot drift from what the fake can do.
 *
 * Gated actions reuse `ProposedAction` from `approval-contract/types.ts`, the
 * taxonomy-free action every enforcement substrate already translates, so the
 * two kits speak of the same logical side effect and neither restates the
 * HITL taxonomy.
 */


import type { Config } from "../../config.js";
import type { HarnessName } from "../../harness/registry.js";
import type { FailureSurface, HarnessAdapter, UsageDelta } from "../../harness/types.js";
import type { ProposedAction } from "../approval-contract/types.js";
import type { TurnInputFixtureOverrides } from "../turn-input-fixture.js";
import type { ApprovalAction } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

/**
 * One thing the engine does during a turn. A turn plays its steps in order
 * and ends `completed` when none is left, unless a step ends it first.
 *
 *  - `say`: the engine emits assistant text (a transcript row).
 *  - `propose`: the engine reaches a gated side effect identified by
 *    `toolCallId`. Undecided → the turn ends `awaiting_approval` and later
 *    steps do not run; APPROVE → the effect runs once and the turn continues;
 *    REJECT / SKIP → the effect never runs and the turn continues. WHICH
 *    kinds a harness gates is the harness's policy and the workspace's
 *    posture: a `shell` is gated by every harness in every posture; a `write`
 *    is gated only outside apply-then-review capture (a git tree, or artifact
 *    storage), so an arm that must gate on every subject proposes a `shell`.
 *  - `read`: the engine performs an UNGATED read of `path` — a tool-call row
 *    that runs at once, never pauses, and is the discrete event every harness
 *    flushes a persist on (the lever an arm pulls when it needs the control
 *    plane to answer a mid-turn persist).
 *  - `usage`: the engine reports one turn's token counts.
 *  - `hang`: the engine makes no further progress until told to stop. The
 *    step that the stop-signal invariants and the runtime's stall watchdog
 *    are built around; it must be parked on the signal, never on a timer.
 *  - `fail`: the engine fails with a message the adapter can name; the turn
 *    ends `failed` on the given surface (`engine` unless the scenario says
 *    otherwise — the runtime's three failure copies are its own invariant).
 *  - `limit`: the engine exhausts the tool-round budget the execution set and
 *    stops at a step boundary with its work checkpointed; the turn ends
 *    `tool_call_limit`. A subject whose engine has no such budget says so and
 *    the runtime arm is reported SKIPPED there.
 *  - `open`: the engine starts an operation identified by `toolCallId` and
 *    keeps it open until the kit releases it: a tool that runs for a while
 *    (`as: "tool"`), or a subagent that works (`as: "subagent"`). With
 *    `streams`, the operation prints each line the kit emits while it runs;
 *    without, it is silent. Parked like `hang`, never on a timer: on the
 *    kit's release the operation finishes and the turn plays on, and the
 *    stop signal ends it the way it ends a hang. The kit times the operation
 *    on the scripted clock (`runtime-contract.ts`, the long-turn arms), so
 *    "ten silent minutes" is clock windows, never wall time. A subject that
 *    cannot open a subagent says so and the arm is reported SKIPPED there.
 *  - `compact`: the engine compacts its context once — the summarization a
 *    long conversation forces — and the turn plays on. A subject whose engine
 *    has no context to compact says so and the arm is reported SKIPPED there.
 *  - `message`: a person sends `text` to the session while the engine plays
 *    the step before it (a tool the engine runs, an answer it writes), and
 *    the engine reads it where every harness reads a message sent mid-turn:
 *    at its next model call after an open operation, at its round's end
 *    after an answer. The subject sends
 *    it through the kit's person ({@link EngineView.sendMessage}) as it plays
 *    the step before, and the engine's reading of it is the step: a subject
 *    whose engine does not read it there fails the script. Never the first
 *    step: a message sent before the turn starts is the turn's own.
 */
export type ScenarioStep =
  | { readonly kind: "say"; readonly text: string }
  | { readonly kind: "propose"; readonly toolCallId: string; readonly action: ProposedAction; readonly flows?: boolean }
  | { readonly kind: "read"; readonly toolCallId: string; readonly path: string }
  | { readonly kind: "usage"; readonly delta: UsageDelta }
  | { readonly kind: "hang" }
  | { readonly kind: "fail"; readonly message: string; readonly surface: FailureSurface }
  | { readonly kind: "limit" }
  | { readonly kind: "open"; readonly toolCallId: string; readonly as: OperationShape; readonly streams: boolean }
  | { readonly kind: "compact" }
  | { readonly kind: "message"; readonly text: string };

/**
 * The saved agent an `open(…, { as: "subagent" })` hands work to: the
 * runtime arm's record lists it, and a subject whose engine delegates by
 * name delegates to this slug and knows the subagent's turns by these
 * instructions (both are in the subagent's own prompt).
 */
export const KIT_SUBAGENT_SLUG = "kit-helper";
export const KIT_SUBAGENT_INSTRUCTIONS = "You are the contract kit's helper. Do the delegated work, then answer.";

/** What an open operation is: a tool the engine runs, or a subagent it hands work to. */
export type OperationShape = "tool" | "subagent";

/** One turn's worth of engine behaviour. */
export type TurnScenario = readonly ScenarioStep[];

/** Step builders — the vocabulary a kit invariant reads as. */
export const scenario = {
  say(text: string): ScenarioStep {
    return { kind: "say", text };
  },
  propose(toolCallId: string, action: ProposedAction): ScenarioStep {
    return { kind: "propose", toolCallId, action };
  },
  /**
   * A `write` the arm EXPECTS to flow under apply-then-review capture (a git
   * work tree, or artifact storage): the engine performs it at once, the row
   * completes, and the RUNTIME captures it for review after the turn
   * (`harness/capture.ts`). The arm states the posture rather than the
   * subject inferring it, so a subject that gates a flowing write is caught,
   * not accommodated. The bytes written are the engine's own; the arm
   * asserts the captured PATH and the reconcile's effect, never the content.
   */
  flowingWrite(toolCallId: string, path: string): ScenarioStep {
    return { kind: "propose", toolCallId, action: { kind: "write", resource: path }, flows: true };
  },
  read(toolCallId: string, path: string): ScenarioStep {
    return { kind: "read", toolCallId, path };
  },
  usage(delta: UsageDelta): ScenarioStep {
    return { kind: "usage", delta };
  },
  hang(): ScenarioStep {
    return { kind: "hang" };
  },
  fail(message: string, surface: FailureSurface = "engine"): ScenarioStep {
    return { kind: "fail", message, surface };
  },
  limit(): ScenarioStep {
    return { kind: "limit" };
  },
  open(toolCallId: string, options: { readonly as?: OperationShape; readonly streams?: boolean } = {}): ScenarioStep {
    return { kind: "open", toolCallId, as: options.as ?? "tool", streams: options.streams ?? false };
  },
  compact(): ScenarioStep {
    return { kind: "compact" };
  },
  message(text: string): ScenarioStep {
    return { kind: "message", text };
  },
} as const;

/** The `message` step that follows the step at `index`, the one a subject sends as it plays that step; undefined when none does. */
export function messageAfter(turn: TurnScenario, index: number): Extract<ScenarioStep, { kind: "message" }> | undefined {
  const next = turn[index + 1];
  return next?.kind === "message" ? next : undefined;
}

/**
 * What the engine can know about the turn it is about to play, handed to the
 * subject with every {@link HarnessContractSubject.arrange}: which execution
 * and session it serves (a real engine is per session — its handle is parked
 * under the session, its workspace and hook state live under the session —
 * so a subject arranges THAT session's engine, never "the next turn"), and
 * the approval decisions the prompt will carry (the runtime's
 * `approvalAnswersOf` over the modelled log and the persisted status — the
 * one map both drivers call). A subject whose engine cannot re-run a settled action, or
 * whose model is told not to perform a skipped one, reads its decision here
 * instead of parsing the prompt for it.
 */
export interface EngineView {
  readonly executionId: string;
  readonly sessionId: string;
  readonly approvalDecisions: ReadonlyMap<string, ApprovalAction>;
  /**
   * The kit's person: sends `text` to the session now, queued for the turn
   * as the server queues a message sent while a turn works (a `message`
   * step). Not the engine's to know; the subject calls it as its engine
   * plays the step before the message.
   */
  readonly sendMessage: (text: string) => void;
}

/**
 * What a subject may say about the record its engine is handed, laid UNDER
 * the driver's own facts: the five it threads (`executionId`, `threadId`,
 * `turnSeq`, `sessionId`, `approvalDecisions`) and the persisted status it
 * seeds are the kit's bookkeeping and never a subject's to state.
 */
export type SubjectInputOverrides = Omit<
  TurnInputFixtureOverrides,
  "executionId" | "threadId" | "turnSeq" | "sessionId" | "approvalDecisions" | "persistedStatus"
>;

/**
 * One adapter under test, with the engine controls the kit needs. Adapters
 * translate scenarios into their own double's drives and report what the
 * double observed; they never reimplement contract behaviour.
 *
 * The kit owns the adapter's lifetime: it boots the adapter before the first
 * turn and shuts it down after the last (the registry boots every adapter
 * before the worker polls, and a real adapter refuses a turn before boot).
 * The exported assertion functions therefore REQUIRE a booted adapter.
 */
export interface HarnessContractSubject {
  /** Stable name, used in suite titles and every assertion message. */
  readonly name: string;
  /** The registry row this adapter fills; the runtime half selects the activity by it. */
  readonly harness: HarnessName;
  /** The adapter under test — the real implementation of the contract. */
  readonly adapter: HarnessAdapter;
  /** What `adapter.boot` needs. The subject knows its adapter's fields; the kit does not. */
  readonly config: Config;
  /**
   * The model this subject's engine runs, named on every record the runtime
   * half builds (`status.run_config.model_name`); the record fixture's model
   * when absent. An engine that runs only its own vendor's models (Claude)
   * names one; an engine whose double ignores the model names none.
   */
  readonly model?: string;
  /**
   * Arrange the engine so that the NEXT `runTurn` for `view.sessionId` plays
   * `turn` — REPLACING whatever was arranged for that session and not yet
   * played (a turn interrupted before its engine ran leaves no stale script
   * behind). Called by the kit before every `runTurn`, including a
   * reinvocation (the engine re-reaches the same gated call on resume, so the
   * same proposal is arranged again).
   */
  arrange(turn: TurnScenario, view: EngineView): void;
  /**
   * What this engine needs the record to say beyond the driver's facts (the
   * model the adapter validates, the workspace its gate installs into). A
   * subject whose engine reads nothing of the record omits it.
   */
  inputOverrides?(view: EngineView): SubjectInputOverrides;
  /**
   * Resolves the next time a turn parks on a `hang` step — the moment the
   * kit stops a turn from the outside, and the moment the runtime half
   * delivers a cancellation, a drain or the clock tick that trips the stall
   * watchdog. A real engine reaches its hang only after real setup (file
   * writes, catalog fetches); a stop delivered any earlier would land in that
   * setup and prove nothing about the hang. Never a timer.
   */
  whenHanging(): Promise<void>;
  /**
   * How many times the side effect behind `toolCallId` actually ran, as the
   * subject's double observed it. The safety-critical observable; zero for an
   * id the engine never reached.
   */
  executionCount(toolCallId: string): number;
  /**
   * The long-turn controls: a subject that can play `open` and `compact`
   * provides them all (`runtime-contract.ts` refuses an arm on a subject
   * that lacks one, naming it). Each is the engine's own fact, read off its
   * double, never a timer.
   */
  readonly longTurn?: LongTurnControls;
}

/** What the long-turn arms drive and read through a subject (see {@link HarnessContractSubject.longTurn}). */
export interface LongTurnControls {
  /** Resolves once the operation behind `toolCallId` is running — the engine's own report, as `whenHanging` is. */
  whenOpen(toolCallId: string): Promise<void>;
  /** A streaming operation prints `line`; resolves once the engine has printed it. */
  emit(toolCallId: string, line: string): Promise<void>;
  /**
   * Let the operation finish, and any operation opened later under the same
   * id finish at once (a reinvocation that re-runs the call). Safe to call on
   * one that never started or already ended.
   */
  release(toolCallId: string): Promise<void>;
  /** How many times the operation behind `toolCallId` began, across every invocation: a step the engine repeated began twice. */
  opened(toolCallId: string): number;
  /** How many times the session's engine was handed `message` as a new request, across every invocation. */
  tasksHanded(sessionId: string, message: string): number;
  /**
   * How many times the session's engine was handed `text` as a message a
   * person sent while its turn worked, across every invocation: a message
   * read twice reads 2, one never read 0.
   */
  messagesRead(sessionId: string, text: string): number;
  /** How many times the session's engine compacted its context, across every invocation. */
  compactions(sessionId: string): number;
  /**
   * What the engine's double answers a compaction's summary with, and the
   * input tokens each summary bills when the runner makes the summary call
   * itself; absent where the vendor's server summarises and bills its own.
   * The text must never reach the person as the agent's words.
   */
  readonly compactionSummary: { readonly text: string; readonly inputTokens?: number };
  /**
   * What each of the session's summary calls asked, in order, across every
   * invocation: where the runner makes the summary call, the text of its one
   * message (the runner's checkpoint prompt with the conversation in it).
   * Absent where the vendor writes its own summary.
   */
  summaryPrompts?(sessionId: string): readonly string[];
  /**
   * The runner driving the session's turn is killed: what the engine keeps
   * outside the process stays as the process left it, and nothing the
   * process would do on its way out reaches it. The kit calls it just
   * before it cancels the lost invocation, so the cancel stands for the
   * process's end, not its stop.
   */
  loseRunner(sessionId: string): void;
}
