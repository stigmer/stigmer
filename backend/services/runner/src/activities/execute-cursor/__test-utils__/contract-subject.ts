/**
 * The Cursor harness as a `HarnessContractSubject` — the REAL `createCursorAdapter()`
 * driven through the harness contract kit, with the kit's engine-neutral
 * scenario vocabulary translated onto S0's scripted `@cursor/sdk` double.
 *
 * The sibling of `gateway-substrate.ts` (the Cursor side of the approval
 * contract kit): the kit owns the invariants and the runtime stand-in, this
 * module owns the ENGINE — what the next turn of a session's agent will do —
 * and reports what the double observed. The adapter under test is the
 * production one, untouched; it imports no `@temporalio/*` (the fence test
 * pins that), which is what lets the kit run it outside any activity
 * context.
 *
 * ── The engine is per session ───────────────────────────────────────────────
 * One scripted agent per session, minted when the kit first arranges a turn
 * for it and handed out by the double's `Agent.create` for THAT session (keyed
 * by the SDK's `platform.workspaceRef`, computed the way the adapter computes
 * it), then parked by the real session cache across turns exactly as in a live
 * worker. Arranging a turn REPLACES the agent's next script, so a turn the
 * adapter interrupts before its `send()` leaves no stale script for the
 * session's next turn. Every session also gets the workspace directory the
 * runtime's provisioner would give it (`<workspaceRootDir>/sessions/<id>`), so
 * both halves of the kit gate in the same directory shape; the hook's
 * active-turn pointer is per workspace, so concurrent sessions cannot repoint
 * each other's hook.
 *
 * ── The translation, one rule per word ──────────────────────────────────────
 *  - `say(text)`      → an `assistant` event. A first send opens with the
 *                       `system/init` event; a resumed send does not (the
 *                       `deny-and-retry` turn-2 script is the precedent).
 *  - `propose(id, a)` → the STREAM tool call (`edit` / `shell` / `delete`, the
 *                       kits' shared translation in `cursor-hook-harness.ts`),
 *                       an `effect` that runs the REAL preToolUse hook the
 *                       adapter installed against the session's workspace,
 *                       and the call's completion event. `executionCount(id)`
 *                       is the hook's `allow` answers for `id` — the SDK
 *                       executes a tool iff the hook allows it, so this is the
 *                       safety-critical observable. WHETHER the call is
 *                       emitted is decided from the kit's view and this
 *                       subject's own memory, as the model and the SDK would
 *                       decide it (see {@link CursorContractSubject.proposeSteps}).
 *  - `usage(delta)`   → a `turn-ended` delta; the adapter prices it.
 *  - `hang`           → an `effect` parked on the run's own `cancelled`
 *                       status, which the adapter's stop-signal listener
 *                       (`turn-stream.ts` `cancelOnStop`) produces. Never a
 *                       timer. Resolves `whenHanging`.
 *  - `fail(msg, s)`   → `engine`: the run ends `{ status: "error" }` and
 *                       `run.wait()` carries the message; `internal`: an
 *                       `effect` throws mid-stream (the adapter's catch
 *                       classifies it). `actionable` is refused as a test bug:
 *                       only the unattributed-hook-block path produces that
 *                       surface, and the kit's invariants do not ask for it.
 *  - `cancelled`      → an `effect` calling `run.cancel()` from the SDK side
 *                       (the `run-cancelled` golden's shape).
 * Every script that does not end in `fail`, `cancelled` or `hang` closes with
 * `finished({ result: <last say> })` so `run.wait()` has an answer.
 *
 * ── Two modelling decisions (S2 M4, Q-M4-4) ─────────────────────────────────
 * A `propose` for an id this subject has already seen the hook ALLOW emits
 * nothing: the real SDK does not re-run a completed tool on resume — the parked
 * agent's conversation already holds the tool's result. A `propose` whose id
 * carries a SKIP or REJECT decision emits nothing either: the resume prompt
 * tells the model the user declined the action and an obedient model moves
 * on. Both are what "the engine re-reaches the same call" and "the turn
 * continues" MEAN for a deny-and-retry harness; neither hides anything from
 * the safety observable, because a fresh identical command from a
 * disobedient model IS a new gated act and Cursor re-gates it — the subject
 * file proves that with {@link CursorContractSubject.forceReissue}.
 *
 * The completion event a `propose` emits is scripted from the answer the hook
 * is EXPECTED to give (deny for an undecided proposal, allow for an approved
 * re-issue); the hook's actual answer is recorded at effect time and any
 * disagreement is kept in {@link CursorContractSubject.hookDisagreements} for
 * the subject file to assert empty — a hook that allows an undecided action
 * would show up there AND in `executionCount`, never be papered over.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ApprovalAction, ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { Config } from "../../../config.js";
import type { HarnessAdapter } from "../../../harness/types.js";
import type { ProposedAction } from "../../../__test-utils__/approval-contract/types.js";
import type {
  EngineView,
  HarnessContractSubject,
  ScenarioStep,
  SubjectInputOverrides,
  TurnScenario,
} from "../../../__test-utils__/harness-contract/types.js";
import type { HermeticEnvironment } from "../../../__test-utils__/hermetic-activity.js";
import { createCursorAdapter } from "../adapter.js";
import { resolvePlatformOptions } from "../session-lifecycle.js";
import { hookInputFor, streamArgsFor, STREAM_NAME, type GatedActionKind } from "./cursor-hook-harness.js";
import { FIXTURE, SDK_CATALOG, hermeticCursorConfig, runWorkspaceHook } from "./hermetic-cursor.js";
import { ScriptedCursorAgent, sdkEvents, step, type ScriptStep, type ScriptedRun } from "./scripted-agent.js";
import { ScriptedCursorSdk, bindScriptedSdk } from "./scripted-sdk.js";

/** The user's message every kit turn asks; the prompt builder needs one and the kit has none to give. */
const KIT_USER_MESSAGE = "Do what the scenario says.";

/** What the double records the SDK "returning" for an allowed tool call. */
const ALLOWED_RESULT = "ok (kit)";

/** The error the SDK surfaces on a hook-denied call, as the goldens script it. */
const HOOK_BLOCKED_RESULT = "Blocked by hook";

/** What this subject remembers about one proposal id across the turns of an execution. */
interface ProposalMemory {
  /** How many times the call has been emitted; the first emission uses the kit's id, a re-issue a fresh one. */
  emitted: number;
  /** How many times the hook allowed it — the execution count. */
  allowed: number;
}

export interface CursorContractSubject extends HarnessContractSubject {
  readonly adapter: HarnessAdapter;
  /** The SDK double the adapter is talking to, for the subject file's own observations. */
  readonly sdk: ScriptedCursorSdk;
  /** The scripted agent minted for a session, once the kit has arranged a turn for it. */
  agentFor(sessionId: string): ScriptedCursorAgent | undefined;
  /**
   * Make the NEXT `propose` of `toolCallId` emit its call whatever the
   * decision or the memory says — the disobedient model, for the observation
   * the kit's vocabulary cannot express.
   */
  forceReissue(toolCallId: string): void;
  /** Every proposal at which the hook answered other than the script expected; the subject file asserts it stays empty. */
  readonly hookDisagreements: readonly string[];
}

/**
 * Build the subject over one hermetic environment (the temp `HOME` the gate's
 * per-session HITL artifacts land under, the temp workspace root). The
 * environment is the caller's to create before and dispose after; the SDK
 * double is bound for the module here, so a file holds one subject.
 */
export function createCursorContractSubject(env: HermeticEnvironment): CursorContractSubject {
  return new CursorSubject(env);
}

class CursorSubject implements CursorContractSubject {
  readonly name = "cursor";
  readonly harness = "cursor" as const;
  readonly adapter: HarnessAdapter;
  readonly config: Config;
  readonly sdk: ScriptedCursorSdk;
  readonly hookDisagreements: string[] = [];

  private readonly agents = new Map<string, ScriptedCursorAgent>();
  private readonly agentsByWorkspaceRef = new Map<string, ScriptedCursorAgent>();
  private readonly proposals = new Map<string, ProposalMemory>();
  private readonly forcedReissues = new Set<string>();
  private readonly hangWaiters: Array<() => void> = [];
  private mintCounter = 0;

  constructor(private readonly env: HermeticEnvironment) {
    this.config = hermeticCursorConfig(env);
    this.adapter = createCursorAdapter();
    this.sdk = new ScriptedCursorSdk({
      agents: [],
      catalog: SDK_CATALOG,
      agentForWorkspaceRef: (ref) => this.agentsByWorkspaceRef.get(ref),
    });
    bindScriptedSdk(this.sdk);
  }

  // ── HarnessContractSubject ────────────────────────────────────────────────

  arrange(turn: TurnScenario, view: EngineView): void {
    const agent = this.agents.get(view.sessionId) ?? this.mintAgent(view.sessionId);
    mkdirSync(this.workspaceRootOf(view.sessionId), { recursive: true });
    agent.arrangeNextTurn(this.translate(turn, view, agent));
  }

  inputOverrides(view: EngineView): SubjectInputOverrides {
    return {
      // The adapter validates the name against its catalog and prices against
      // the registry fixture; both know exactly this model.
      model: { requested: FIXTURE.model, serviceTier: ServiceTier.STANDARD, thinkingMode: ThinkingMode.DISABLED },
      workspaceDir: this.workspaceRootOf(view.sessionId),
      message: KIT_USER_MESSAGE,
    };
  }

  whenHanging(): Promise<void> {
    return new Promise((resolve) => this.hangWaiters.push(resolve));
  }

  executionCount(toolCallId: string): number {
    return this.proposals.get(toolCallId)?.allowed ?? 0;
  }

  // ── The subject file's observations ──────────────────────────────────────

  agentFor(sessionId: string): ScriptedCursorAgent | undefined {
    return this.agents.get(sessionId);
  }

  forceReissue(toolCallId: string): void {
    this.forcedReissues.add(toolCallId);
  }

  // ── The engine ────────────────────────────────────────────────────────────

  /** The directory the runtime's provisioner gives a session with no workspace entries (`session-root.ts`). */
  private workspaceRootOf(sessionId: string): string {
    return join(this.env.workspaceRootDir, "sessions", sessionId);
  }

  private mintAgent(sessionId: string): ScriptedCursorAgent {
    const agent = new ScriptedCursorAgent({ agentId: `agent-kit-${++this.mintCounter}`, turns: [] });
    this.agents.set(sessionId, agent);
    // The adapter asks the SDK to create an agent for the session under this
    // ref; the double answers with this agent.
    const { workspaceRef } = resolvePlatformOptions(sessionId, this.config.workspaceRootDir);
    this.agentsByWorkspaceRef.set(workspaceRef, agent);
    return agent;
  }

  private translate(turn: TurnScenario, view: EngineView, agent: ScriptedCursorAgent): ScriptStep[] {
    const ev = sdkEvents(agent.agentId, agent.nextRunId);
    const script: ScriptStep[] = [];
    if (agent.sends.length === 0) script.push(step.event(ev.init()));

    let lastSay = "";
    let ended = false;
    for (const s of turn) {
      switch (s.kind) {
        case "say":
          script.push(step.event(ev.assistant(s.text)));
          lastSay = s.text;
          break;
        case "propose":
          script.push(...this.proposeSteps(s.toolCallId, s.action, view, ev));
          break;
        case "usage":
          script.push(
            step.turnEnded({
              inputTokens: s.delta.inputTokens,
              outputTokens: s.delta.outputTokens,
              cacheReadTokens: s.delta.cacheReadTokens,
              cacheWriteTokens: s.delta.cacheWriteTokens,
            }),
          );
          break;
        case "hang":
          script.push(step.effect("kit: hang until the adapter cancels the run", ({ run }) => this.park(run)));
          ended = true;
          break;
        case "fail":
          switch (s.surface) {
            case "engine":
              script.push(step.errored({ result: s.message }));
              break;
            case "internal":
              script.push(
                step.effect("kit: the transport breaks mid-stream", () => {
                  throw new Error(s.message);
                }),
              );
              break;
            case "actionable":
              throw new Error(`${this.name}: fail(..., "actionable") is not producible by this subject (only the unattributed hook block reaches that surface); test bug`);
            default: {
              const exhaustive: never = s.surface;
              throw new Error(`${this.name}: unknown failure surface ${String(exhaustive)}`);
            }
          }
          ended = true;
          break;
        case "cancelled":
          script.push(step.effect("kit: the SDK cancels its own run", ({ run }) => run.cancel()));
          ended = true;
          break;
        default: {
          const exhaustive: never = s;
          throw new Error(`${this.name}: unknown scenario step ${JSON.stringify(exhaustive)}`);
        }
      }
    }
    if (!ended) script.push(step.finished({ result: lastSay, model: { id: FIXTURE.model, params: [] } }));
    return script;
  }

  /**
   * Whether the model emits the gated call this turn, and what the hook is
   * expected to answer — one rule per case (see the header). `undefined`
   * means "nothing is emitted".
   */
  private emissionFor(toolCallId: string, view: EngineView): { readonly expectAllow: boolean } | undefined {
    if (this.forcedReissues.delete(toolCallId)) {
      // The disobedient model: emitted regardless; the hook decides on its own
      // (a grant exists only for an APPROVE), so what to expect is the grant.
      return { expectAllow: view.approvalDecisions.get(toolCallId) === ApprovalAction.APPROVE };
    }
    if ((this.proposals.get(toolCallId)?.allowed ?? 0) > 0) return undefined;
    const decision = view.approvalDecisions.get(toolCallId) ?? ApprovalAction.UNSPECIFIED;
    switch (decision) {
      case ApprovalAction.UNSPECIFIED:
        return { expectAllow: false };
      case ApprovalAction.APPROVE:
      case ApprovalAction.APPROVE_ALL:
        return { expectAllow: true };
      case ApprovalAction.SKIP:
      case ApprovalAction.REJECT:
        return undefined;
      default: {
        const exhaustive: never = decision;
        throw new Error(`${this.name}: unknown approval action ${String(exhaustive)}`);
      }
    }
  }

  private proposeSteps(toolCallId: string, action: ProposedAction, view: EngineView, ev: ReturnType<typeof sdkEvents>): ScriptStep[] {
    const emission = this.emissionFor(toolCallId, view);
    if (!emission) return [];
    if (action.kind === "read" || action.kind === "mcp") {
      throw new Error(`${this.name}: propose(${action.kind}) is not a gated built-in on this harness; test bug`);
    }
    const gated: ProposedAction & { kind: GatedActionKind } = { ...action, kind: action.kind };
    const memory = this.proposals.get(toolCallId) ?? { emitted: 0, allowed: 0 };
    this.proposals.set(toolCallId, memory);
    // The first emission carries the kit's id (the WAITING row the kit looks
    // up); a re-issue carries a fresh call id, as the resumed SDK agent does,
    // and the adapter reconciles it onto the committed row by identity.
    const callId = memory.emitted === 0 ? toolCallId : `${toolCallId}#${memory.emitted}`;
    memory.emitted += 1;
    const name = STREAM_NAME[gated.kind];
    const args = streamArgsFor(gated);
    const workspaceRoot = this.workspaceRootOf(view.sessionId);
    return [
      step.event(ev.toolCall(callId, name, "running", args)),
      step.effect(`kit: the real hook judges ${name} ${gated.resource}`, () => {
        const { permission } = runWorkspaceHook(workspaceRoot, hookInputFor(gated));
        if (permission === "allow") memory.allowed += 1;
        if ((permission === "allow") !== emission.expectAllow) {
          this.hookDisagreements.push(`${toolCallId}: expected ${emission.expectAllow ? "allow" : "deny"}, hook answered ${permission}`);
        }
      }),
      emission.expectAllow
        ? step.event(ev.toolCall(callId, name, "completed", args, ALLOWED_RESULT))
        : step.event(ev.toolCall(callId, name, "error", args, HOOK_BLOCKED_RESULT)),
    ];
  }

  /**
   * Park until the adapter cancels the run — the real shape of "the engine
   * makes no progress until told to stop": the adapter's stop-signal listener
   * calls `run.cancel()`, the double's status flips, and its stream breaks at
   * the next step.
   */
  private park(run: ScriptedRun): Promise<void> {
    for (const waiter of this.hangWaiters.splice(0)) waiter();
    if (run.status === "cancelled") return Promise.resolve();
    return new Promise((resolve) => {
      const unsubscribe = run.onDidChangeStatus((status) => {
        if (status !== "cancelled") return;
        unsubscribe();
        resolve();
      });
    });
  }
}
