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
 * harness's own double (the Cursor subject onto the scripted `@cursor/sdk`
 * agent of `execute-cursor/__test-utils__/`). One vocabulary, not one per
 * engine, so the kit cannot drift from what the fake can do.
 *
 * Gated actions reuse `ProposedAction` from `approval-contract/types.ts`, the
 * taxonomy-free action every enforcement substrate already translates, so the
 * two kits speak of the same logical side effect and neither restates the
 * HITL taxonomy.
 */

import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { Config } from "../../config.js";
import type { HarnessName } from "../../harness/registry.js";
import type { FailureSurface, HarnessAdapter, UsageDelta } from "../../harness/types.js";
import type { ProposedAction } from "../approval-contract/types.js";
import type { TurnInputFixtureOverrides } from "../turn-input-fixture.js";

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
 *  - `cancelled`: the engine ends its own run cancelled with nothing to
 *    wait for (an SDK-side cancel); the turn ends `cancelled`.
 */
export type ScenarioStep =
  | { readonly kind: "say"; readonly text: string }
  | { readonly kind: "propose"; readonly toolCallId: string; readonly action: ProposedAction }
  | { readonly kind: "read"; readonly toolCallId: string; readonly path: string }
  | { readonly kind: "usage"; readonly delta: UsageDelta }
  | { readonly kind: "hang" }
  | { readonly kind: "fail"; readonly message: string; readonly surface: FailureSurface }
  | { readonly kind: "cancelled" };

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
  cancelled(): ScenarioStep {
    return { kind: "cancelled" };
  },
} as const;

/**
 * What the engine can know about the turn it is about to play, handed to the
 * subject with every {@link HarnessContractSubject.arrange}: which execution
 * and session it serves (a real engine is per session — its handle is parked
 * under the session, its workspace and hook state live under the session —
 * so a subject arranges THAT session's engine, never "the next turn"), and
 * the approval decisions the prompt will carry (the runtime's
 * `approvalDecisionsOf` over the persisted status — the one reader both
 * drivers call). A subject whose engine cannot re-run a settled action, or
 * whose model is told not to perform a skipped one, reads its decision here
 * instead of parsing the prompt for it.
 */
export interface EngineView {
  readonly executionId: string;
  readonly sessionId: string;
  readonly approvalDecisions: ReadonlyMap<string, ApprovalAction>;
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
}
