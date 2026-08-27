/**
 * Named gate slots — the pipeline injection mechanism of the convergence
 * blueprint (20260826.02 blueprint/03 §3, DD-006 §2). A slot is a point in
 * a shared per-RPC chain where the builder splices extension-registered
 * gate steps: zero steps in OSS, the cloud's gates in the cloud
 * composition. Slot names are PROTECTED VOCABULARY (never renamed,
 * byte-stable), scoped `<chain-name>:<position>`.
 *
 * O1 (20260826.09) shipped the mechanism; O4 (20260827.07) declares the
 * ratified slots at their Java-verified semantic positions. FIVE of the
 * six ratified names are declared here — `sandbox-acquisition:gate` is
 * declared by O6 together with the provisioner invocation step it gates
 * (O4 plan-gate ruling Q1: a declared slot whose steps can never run
 * would be a silent no-op, the exact failure §2b exists to prevent).
 *
 * Two enforcement layers, deliberately redundant, both derived from the
 * ONE literal tuple below (lockstep by construction):
 *   - GateSlotName (compile time): the union of declared slot literals.
 *     A TS consumer cannot express a registration into an unknown slot.
 *   - DECLARED_GATE_SLOTS (boot time): the load-bearing §2b contract. A JS
 *     consumer, or a composition built against a pin where a slot has
 *     since moved, must throw loudly at boot — never no-op silently.
 *
 * Slot semantics for gate authors (recorded facts, not mechanisms —
 * details in the ts-server guidelines' slot table):
 *   - Slots run wherever their chain runs, INCLUDING in-process
 *     invocations (the Java baseline: internal creations traverse the
 *     full nested handler chains). In-process callers carry
 *     `callerClass: "internal"` (O2's ratified identity semantics), where
 *     the Java edition propagated the original caller — gates keying on
 *     caller class must account for the `internal` arm.
 *   - Slots do not honor chain-internal skip shortcuts (e.g. the
 *     lifecycle already-in-target idempotent flag): a gate runs on every
 *     traversal of its position and owns its own idempotency.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { PipelineStep } from "../pipeline/pipeline.js";

/**
 * The ratified slot names (blueprint 03 §3a). Grows only with
 * owner-visible slot additions — each entry cites its chain position in
 * the guidelines' slot table, which must match the splice sites exactly.
 */
export const GATE_SLOT_NAMES = [
  "agent-execution-create:pre-side-effect-gate",
  "agent-execution-recover:pre-side-effect-gate",
  "agent-execution-submit-approval:gate",
  "session-create:pre-side-effect-gate",
  "org-create:post-persist",
] as const;

/** The declared slot-name union — a registration outside it fails tsc. */
export type GateSlotName = (typeof GATE_SLOT_NAMES)[number];

/**
 * The boot-time declared-slot set — resolveExtensions validates every
 * registration against it (the §2b unknown-slot throw).
 */
export const DECLARED_GATE_SLOTS: ReadonlySet<string> = new Set<string>(
  GATE_SLOT_NAMES,
);

/**
 * The merged slot registrations the chains consume — slot name → steps in
 * unit order (registry.ts builds it; keys are validated slot names).
 */
export type ResolvedGateSteps = ReadonlyMap<
  string,
  ReadonlyArray<PipelineStep<DescMessage>>
>;

/**
 * The steps registered into one slot, typed for the consuming chain — the
 * ONE place the empty-slot default lives, so splice sites never scatter
 * `?? []` and a slot-name typo is a compile error.
 */
export function stepsForSlot<Desc extends DescMessage>(
  gateSteps: ResolvedGateSteps,
  slot: GateSlotName,
): ReadonlyArray<PipelineStep<Desc>> {
  const steps = gateSteps.get(slot) ?? [];
  // Sound narrowing: a gate step is written against
  // RequestContext<DescMessage> and consumes only the context surface
  // every specialization shares. Centralized here so no chain carries a
  // local cast.
  return steps as ReadonlyArray<PipelineStep<Desc>>;
}
