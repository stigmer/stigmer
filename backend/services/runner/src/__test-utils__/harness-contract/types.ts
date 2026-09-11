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

import type { Config } from "../../config.js";
import type { FailureSurface, HarnessAdapter, UsageDelta } from "../../harness/types.js";
import type { ProposedAction } from "../approval-contract/types.js";

/**
 * One thing the engine does during a turn. A turn plays its steps in order
 * and ends `completed` when none is left, unless a step ends it first.
 *
 *  - `say`: the engine emits assistant text (a transcript row).
 *  - `propose`: the engine reaches a gated side effect identified by
 *    `toolCallId`. Undecided → the turn ends `awaiting_approval` and later
 *    steps do not run; APPROVE → the effect runs once and the turn continues;
 *    REJECT / SKIP → the effect never runs and the turn continues.
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
 * One adapter under test, with the engine controls the kit needs. Adapters
 * translate scenarios into their own double's drives and report what the
 * double observed; they never reimplement contract behaviour.
 */
export interface HarnessContractSubject {
  /** Stable name, used in suite titles and every assertion message. */
  readonly name: string;
  /** The adapter under test — the real implementation of the contract. */
  readonly adapter: HarnessAdapter;
  /** What `adapter.boot` needs. The subject knows its adapter's fields; the kit does not. */
  readonly config: Config;
  /**
   * Arrange the engine so that the NEXT `runTurn` on this adapter plays
   * `turn`. Called by the kit before every `runTurn`, including a
   * reinvocation (the engine re-reaches the same gated call on resume, so the
   * same proposal is arranged again).
   */
  arrange(turn: TurnScenario): void;
  /**
   * How many times the side effect behind `toolCallId` actually ran, as the
   * subject's double observed it. The safety-critical observable; zero for an
   * id the engine never reached.
   */
  executionCount(toolCallId: string): number;
}
